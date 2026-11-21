//! Google Calendar for Deadline Radar: direct sign-in and a read-only fetch of upcoming events.
//!
//! * Sign-in is OAuth 2.0 for installed apps: the browser opens Google's consent page, Google
//!   redirects to a one-shot listener on `127.0.0.1:<random port>`, and the code is exchanged with a
//!   PKCE verifier. The only scope is `calendar.readonly`.
//! * This is Daybar's second deliberate network exception (docs/DECISIONS.md 017). It talks only to
//!   `accounts.google.com`, `oauth2.googleapis.com` and `www.googleapis.com`, and only while signed in.
//! * The client ID, client secret and refresh token are kept together in one macOS Keychain item.
//!   Nothing about Google is written to the data folder, so the phone never sees it.
//! * The pure parts (PKCE, URLs, the redirect, event JSON) are platform independent and tested here;
//!   the Keychain and the browser are macOS only.
use super::{ItemKind, RadarCalendar, RadarItem};
use base64::Engine;
use chrono::{DateTime, Local, NaiveDate, TimeZone, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};

const AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const REVOKE_URL: &str = "https://oauth2.googleapis.com/revoke";
const API: &str = "https://www.googleapis.com/calendar/v3";
const SCOPE: &str = "https://www.googleapis.com/auth/calendar.readonly";
/// How long the sign-in waits for the browser to come back.
const SIGN_IN_TIMEOUT: Duration = Duration::from_secs(300);
/// Pages of 250 events per calendar; more than enough for a Radar window.
const MAX_PAGES: usize = 8;
/// Shown in the Radar account column for Google calendars.
pub const ACCOUNT_PREFIX: &str = "Google";

/// Everything needed to stay signed in. Stored as one JSON Keychain item.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Credentials {
    pub client_id: String,
    pub client_secret: String,
    pub refresh_token: String,
    /// The signed-in address (the primary calendar's id), for display.
    pub account: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleStatus {
    /// False where the Keychain is not available (anything but the Mac app).
    pub supported: bool,
    pub connected: bool,
    pub account: Option<String>,
}

/// The Keychain item, read once per run and then kept in memory (it changes only through
/// [`connect`] and [`disconnect`]), so status checks and refreshes do not touch the Keychain.
static SAVED: Mutex<Option<Option<Credentials>>> = Mutex::new(None);
fn saved() -> Result<Option<Credentials>, String> {
    let mut slot = SAVED.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(c) = slot.as_ref() {
        return Ok(c.clone());
    }
    let loaded = keychain::load()?;
    *slot = Some(loaded.clone());
    Ok(loaded)
}
fn set_saved(c: Option<Credentials>) {
    *SAVED.lock().unwrap_or_else(|e| e.into_inner()) = Some(c);
}

pub fn status() -> GoogleStatus {
    let account = saved().ok().flatten().map(|c| c.account);
    GoogleStatus {
        supported: keychain::SUPPORTED,
        connected: account.is_some(),
        account,
    }
}

// ---------------------------------------------------------------------------------------------
// Pure pieces
// ---------------------------------------------------------------------------------------------

fn b64(bytes: &[u8]) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

fn random(len: usize) -> Result<Vec<u8>, String> {
    let mut out = vec![0u8; len];
    ring::rand::SecureRandom::fill(&ring::rand::SystemRandom::new(), &mut out)
        .map_err(|_| "Could not generate a random sign-in code".to_string())?;
    Ok(out)
}

/// The PKCE challenge (S256) for a verifier.
pub fn challenge(verifier: &str) -> String {
    b64(ring::digest::digest(&ring::digest::SHA256, verifier.as_bytes()).as_ref())
}

pub fn auth_url(client_id: &str, redirect: &str, challenge: &str, state: &str) -> String {
    let query = url::form_urlencoded::Serializer::new(String::new())
        .append_pair("client_id", client_id)
        .append_pair("redirect_uri", redirect)
        .append_pair("response_type", "code")
        .append_pair("scope", SCOPE)
        .append_pair("code_challenge", challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("state", state)
        .append_pair("access_type", "offline")
        .append_pair("prompt", "consent")
        .finish();
    format!("{AUTH_URL}?{query}")
}

/// What came back on the redirect.
#[derive(Debug, PartialEq, Eq)]
pub enum Callback {
    Code(String),
    /// The user declined, or Google refused (its `error` value).
    Denied(String),
    /// Not the redirect (a favicon request, a stray connection): keep waiting.
    Other,
}

/// Reads the request line (`GET /?code=…&state=… HTTP/1.1`) and checks `state`.
pub fn parse_callback(request_line: &str, state: &str) -> Result<Callback, String> {
    let mut parts = request_line.split_whitespace();
    let (Some("GET"), Some(target)) = (parts.next(), parts.next()) else {
        return Ok(Callback::Other);
    };
    let Some(query) = target.strip_prefix("/?") else {
        return Ok(Callback::Other);
    };
    let pairs: Vec<(String, String)> = url::form_urlencoded::parse(query.as_bytes())
        .into_owned()
        .collect();
    let get = |k: &str| pairs.iter().find(|(key, _)| key == k).map(|(_, v)| v.clone());
    if get("state").as_deref() != Some(state) {
        return Err("The sign-in reply did not match this request. Try connecting again.".into());
    }
    if let Some(error) = get("error") {
        return Ok(Callback::Denied(error));
    }
    get("code")
        .map(Callback::Code)
        .ok_or_else(|| "Google did not send a sign-in code.".into())
}

fn local_midnight_ms(day: NaiveDate) -> Option<i64> {
    (0..4).find_map(|h| {
        day.and_hms_opt(h, 0, 0)
            .and_then(|n| Local.from_local_datetime(&n).earliest())
            .map(|t| t.timestamp_millis())
    })
}

/// One end of an event: `{"date": "2026-11-21"}` (all day) or `{"dateTime": "...Z"}`.
fn when(v: &Value) -> Option<(i64, bool)> {
    if let Some(dt) = v.get("dateTime").and_then(Value::as_str) {
        return DateTime::parse_from_rfc3339(dt)
            .ok()
            .map(|d| (d.with_timezone(&Utc).timestamp_millis(), false));
    }
    let day = NaiveDate::parse_from_str(v.get("date")?.as_str()?, "%Y-%m-%d").ok()?;
    local_midnight_ms(day).map(|ms| (ms, true))
}

/// Events from one page of `events.list` for the calendar `source`, plus the next page token.
/// Cancelled and untitled-and-unscheduled entries are skipped; an all-day event ends just before its
/// (exclusive) end date, as EventKit reports it.
pub fn parse_events(page: &Value, calendar_id: &str, source: &str) -> (Vec<RadarItem>, Option<String>) {
    let mut out = Vec::new();
    for e in page.get("items").and_then(Value::as_array).into_iter().flatten() {
        if e.get("status").and_then(Value::as_str) == Some("cancelled") {
            continue;
        }
        let (Some(id), Some((start, all_day))) = (
            e.get("id").and_then(Value::as_str),
            e.get("start").and_then(when),
        ) else {
            continue;
        };
        let end = e
            .get("end")
            .and_then(when)
            .map(|(ms, _)| if all_day { ms - 1000 } else { ms });
        let title = e
            .get("summary")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|t| !t.is_empty())
            .unwrap_or("(No title)");
        out.push(RadarItem {
            id: format!("google:{calendar_id}:{id}"),
            title: title.to_string(),
            date: start,
            end,
            all_day,
            source: source.to_string(),
            kind: ItemKind::Event,
        });
    }
    let next = page
        .get("nextPageToken")
        .and_then(Value::as_str)
        .map(String::from);
    (out, next)
}

/// A calendar from `calendarList`: its id, its display name, and whether it is the primary one.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Calendar {
    pub id: String,
    pub name: String,
    pub primary: bool,
}
pub fn parse_calendars(list: &Value) -> Vec<Calendar> {
    list.get("items")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|c| c.get("hidden").and_then(Value::as_bool) != Some(true))
        .filter_map(|c| {
            let id = c.get("id")?.as_str()?.to_string();
            let name = c
                .get("summaryOverride")
                .or_else(|| c.get("summary"))
                .and_then(Value::as_str)
                .unwrap_or(&id)
                .to_string();
            Some(Calendar {
                primary: c.get("primary").and_then(Value::as_bool) == Some(true),
                id,
                name,
            })
        })
        .collect()
}

/// `items` plus every Google item that is not already there from EventKit (an account added to
/// macOS Calendar too would otherwise show each event twice). Same title and start = same event.
pub fn merge(mut items: Vec<RadarItem>, google: Vec<RadarItem>) -> Vec<RadarItem> {
    let seen: std::collections::HashSet<(String, i64)> = items
        .iter()
        .filter(|i| i.kind == ItemKind::Event)
        .map(|i| (i.title.trim().to_lowercase(), i.date))
        .collect();
    items.extend(
        google
            .into_iter()
            .filter(|i| !seen.contains(&(i.title.trim().to_lowercase(), i.date))),
    );
    items
}

fn rfc3339(ms: i64) -> String {
    Utc.timestamp_millis_opt(ms)
        .single()
        .unwrap_or_default()
        .to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

// ---------------------------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------------------------

fn client() -> Result<reqwest::blocking::Client, String> {
    // reqwest is built without a default crypto provider; the updater installs the same one.
    let _ = rustls::crypto::ring::default_provider().install_default();
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(20))
        .user_agent("Daybar")
        .build()
        .map_err(|e| format!("Could not start a network client: {e}"))
}

fn json(resp: reqwest::blocking::Response) -> Result<Value, String> {
    let status = resp.status();
    let body = resp.text().map_err(|e| format!("Google did not answer: {e}"))?;
    let value: Value = serde_json::from_str(&body).unwrap_or(Value::Null);
    if status.is_success() {
        return Ok(value);
    }
    let reason = value
        .get("error_description")
        .or_else(|| value.pointer("/error/message"))
        .or_else(|| value.get("error"))
        .and_then(Value::as_str)
        .unwrap_or("unknown error");
    if value.get("error").and_then(Value::as_str) == Some("invalid_grant") {
        return Err("Google sign-in has expired or was revoked. Connect Google Calendar again in Settings.".into());
    }
    Err(format!("Google refused the request ({status}): {reason}"))
}

fn post_form(pairs: &[(&str, &str)], to: &str) -> Result<Value, String> {
    let body = url::form_urlencoded::Serializer::new(String::new())
        .extend_pairs(pairs)
        .finish();
    let resp = client()?
        .post(to)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(body)
        .send()
        .map_err(|e| format!("Could not reach Google: {e}"))?;
    json(resp)
}

fn get(path_and_query: &str, token: &str) -> Result<Value, String> {
    let resp = client()?
        .get(format!("{API}{path_and_query}"))
        .bearer_auth(token)
        .send()
        .map_err(|e| format!("Could not reach Google Calendar: {e}"))?;
    json(resp)
}

/// Access token and when it expires (epoch ms), kept in memory only.
static TOKEN: Mutex<Option<(String, i64)>> = Mutex::new(None);
fn token_slot() -> MutexGuard<'static, Option<(String, i64)>> {
    TOKEN.lock().unwrap_or_else(|e| e.into_inner())
}

fn access_token(c: &Credentials) -> Result<String, String> {
    let now = Utc::now().timestamp_millis();
    if let Some((token, expires)) = token_slot().clone() {
        if expires - 60_000 > now {
            return Ok(token);
        }
    }
    let v = post_form(
        &[
            ("client_id", &c.client_id),
            ("client_secret", &c.client_secret),
            ("refresh_token", &c.refresh_token),
            ("grant_type", "refresh_token"),
        ],
        TOKEN_URL,
    )?;
    remember(&v)
}

fn remember(v: &Value) -> Result<String, String> {
    let token = v
        .get("access_token")
        .and_then(Value::as_str)
        .ok_or("Google did not return an access token")?
        .to_string();
    let seconds = v.get("expires_in").and_then(Value::as_i64).unwrap_or(3600);
    *token_slot() = Some((token.clone(), Utc::now().timestamp_millis() + seconds * 1000));
    Ok(token)
}

fn encode(segment: &str) -> String {
    url::form_urlencoded::byte_serialize(segment.as_bytes()).collect()
}

fn calendars(token: &str) -> Result<Vec<Calendar>, String> {
    let mut out = Vec::new();
    let mut page: Option<String> = None;
    for _ in 0..MAX_PAGES {
        let mut path = "/users/me/calendarList?minAccessRole=reader&maxResults=250".to_string();
        if let Some(p) = &page {
            path.push_str(&format!("&pageToken={}", encode(p)));
        }
        let v = get(&path, token)?;
        out.extend(parse_calendars(&v));
        page = v.get("nextPageToken").and_then(Value::as_str).map(String::from);
        if page.is_none() {
            break;
        }
    }
    Ok(out)
}

/// What one Google read produced.
pub struct Fetched {
    pub items: Vec<RadarItem>,
    pub calendars: Vec<RadarCalendar>,
}

/// Events between two instants from every visible calendar (or only `wanted` ones, by name), and
/// the calendar list for the Settings picker. `None` when not signed in.
pub fn fetch(from_ms: i64, to_ms: i64, wanted: &[String]) -> Option<Result<Fetched, String>> {
    let creds = match saved() {
        Ok(Some(c)) => c,
        Ok(None) => return None,
        Err(e) => return Some(Err(e)),
    };
    Some(fetch_with(&creds, from_ms, to_ms, wanted))
}

fn fetch_with(c: &Credentials, from_ms: i64, to_ms: i64, wanted: &[String]) -> Result<Fetched, String> {
    let token = access_token(c)?;
    let list = calendars(&token)?;
    let account = format!("{ACCOUNT_PREFIX} · {}", c.account);
    let mut items = Vec::new();
    for cal in list.iter().filter(|cal| wanted.is_empty() || wanted.contains(&cal.name)) {
        let mut page: Option<String> = None;
        for _ in 0..MAX_PAGES {
            let mut path = format!(
                "/calendars/{}/events?singleEvents=true&orderBy=startTime&maxResults=250&timeMin={}&timeMax={}",
                encode(&cal.id),
                encode(&rfc3339(from_ms)),
                encode(&rfc3339(to_ms))
            );
            if let Some(p) = &page {
                path.push_str(&format!("&pageToken={}", encode(p)));
            }
            let (found, next) = parse_events(&get(&path, &token)?, &cal.id, &cal.name);
            items.extend(found);
            page = next;
            if page.is_none() {
                break;
            }
        }
    }
    let calendars = list
        .into_iter()
        .map(|cal| RadarCalendar { title: cal.name, account: account.clone() })
        .collect();
    Ok(Fetched { items, calendars })
}

// ---------------------------------------------------------------------------------------------
// Sign-in and sign-out
// ---------------------------------------------------------------------------------------------

const DONE_PAGE: &str = "<!doctype html><meta charset=utf-8><title>Daybar</title><body style=\"font:14px -apple-system,sans-serif;background:#0d1117;color:#fff;display:grid;place-items:center;height:90vh\"><p>";

fn reply(stream: &mut TcpStream, message: &str) {
    let body = format!("{DONE_PAGE}{message}</p>");
    let _ = write!(
        stream,
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
}

fn read_request_line(stream: &mut TcpStream) -> String {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    let mut buf = [0u8; 4096];
    let mut got = Vec::new();
    while !got.windows(2).any(|w| w == b"\r\n") && got.len() < 8192 {
        match stream.read(&mut buf) {
            Ok(0) | Err(_) => break,
            Ok(n) => got.extend_from_slice(&buf[..n]),
        }
    }
    String::from_utf8_lossy(&got).lines().next().unwrap_or("").to_string()
}

/// Waits on `listener` for Google's redirect and returns the code.
fn wait_for_code(listener: &TcpListener, state: &str) -> Result<String, String> {
    listener
        .set_nonblocking(true)
        .map_err(|e| format!("Could not listen for the sign-in reply: {e}"))?;
    let deadline = Instant::now() + SIGN_IN_TIMEOUT;
    while Instant::now() < deadline {
        match listener.accept() {
            Ok((mut stream, _)) => {
                let _ = stream.set_nonblocking(false);
                match parse_callback(&read_request_line(&mut stream), state) {
                    Ok(Callback::Code(code)) => {
                        reply(&mut stream, "Daybar is connected to Google Calendar. You can close this tab.");
                        return Ok(code);
                    }
                    Ok(Callback::Denied(why)) => {
                        reply(&mut stream, "Google Calendar was not connected. You can close this tab.");
                        return Err(if why == "access_denied" {
                            "Google Calendar was not connected: access was declined.".into()
                        } else {
                            format!("Google refused the sign-in: {why}")
                        });
                    }
                    Ok(Callback::Other) => {
                        let _ = write!(stream, "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                    }
                    Err(e) => {
                        reply(&mut stream, "This sign-in link is out of date. Return to Daybar and try again.");
                        return Err(e);
                    }
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(150));
            }
            Err(e) => return Err(format!("The sign-in listener failed: {e}")),
        }
    }
    Err("Sign-in timed out after 5 minutes. Try again when the browser is ready.".into())
}

/// The whole sign-in: browser consent, code exchange, a first calendar read, then the Keychain.
pub fn connect(client_id: &str, client_secret: &str) -> Result<GoogleStatus, String> {
    let client_id = client_id.trim();
    let client_secret = client_secret.trim();
    if !keychain::SUPPORTED {
        return Err("Google Calendar sign-in works in the Mac app only.".into());
    }
    if !client_id.ends_with(".apps.googleusercontent.com") {
        return Err("That does not look like a Google OAuth client ID (it ends in .apps.googleusercontent.com).".into());
    }
    if client_secret.is_empty() {
        return Err("Paste the client secret that came with the client ID.".into());
    }
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("Could not open a local port for the sign-in: {e}"))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let redirect = format!("http://127.0.0.1:{port}");
    let verifier = b64(&random(32)?);
    let state = b64(&random(16)?);
    open_browser(&auth_url(client_id, &redirect, &challenge(&verifier), &state))?;
    let code = wait_for_code(&listener, &state)?;
    drop(listener);
    let v = post_form(
        &[
            ("code", &code),
            ("client_id", client_id),
            ("client_secret", client_secret),
            ("redirect_uri", &redirect),
            ("grant_type", "authorization_code"),
            ("code_verifier", &verifier),
        ],
        TOKEN_URL,
    )?;
    let refresh_token = v
        .get("refresh_token")
        .and_then(Value::as_str)
        .ok_or("Google did not grant offline access. Remove Daybar at myaccount.google.com → Security → Third-party access, then connect again.")?
        .to_string();
    let token = remember(&v)?;
    let list = calendars(&token)?;
    let account = list
        .iter()
        .find(|c| c.primary)
        .map(|c| c.id.clone())
        .unwrap_or_else(|| "Google account".into());
    let creds = Credentials {
        client_id: client_id.into(),
        client_secret: client_secret.into(),
        refresh_token,
        account,
    };
    keychain::save(&creds)?;
    set_saved(Some(creds));
    Ok(status())
}

/// Revokes the grant (best effort: offline is fine) and forgets everything.
pub fn disconnect() -> Result<GoogleStatus, String> {
    if let Ok(Some(c)) = saved() {
        let _ = post_form(&[("token", &c.refresh_token)], REVOKE_URL);
    }
    *token_slot() = None;
    keychain::delete()?;
    set_saved(None);
    Ok(status())
}

#[cfg(target_os = "macos")]
fn open_browser(url: &str) -> Result<(), String> {
    std::process::Command::new("/usr/bin/open")
        .arg(url)
        .status()
        .map_err(|e| format!("Could not open the browser: {e}"))
        .and_then(|s| if s.success() { Ok(()) } else { Err("Could not open the browser.".into()) })
}
#[cfg(not(target_os = "macos"))]
fn open_browser(_url: &str) -> Result<(), String> {
    Err("Google Calendar sign-in works in the Mac app only.".into())
}

#[cfg(target_os = "macos")]
mod keychain {
    use super::Credentials;
    use security_framework::passwords::{delete_generic_password, get_generic_password, set_generic_password};
    pub const SUPPORTED: bool = true;
    const SERVICE: &str = "Daybar · Google Calendar";
    const ACCOUNT: &str = "oauth";
    /// errSecItemNotFound
    const NOT_FOUND: i32 = -25300;

    pub fn load() -> Result<Option<Credentials>, String> {
        match get_generic_password(SERVICE, ACCOUNT) {
            Ok(bytes) => serde_json::from_slice(&bytes)
                .map(Some)
                .map_err(|_| "The saved Google sign-in is unreadable. Disconnect and connect again.".into()),
            Err(e) if e.code() == NOT_FOUND => Ok(None),
            Err(e) => Err(format!("Could not read the Google sign-in from the Keychain: {e}")),
        }
    }
    pub fn save(c: &Credentials) -> Result<(), String> {
        let bytes = serde_json::to_vec(c).map_err(|e| e.to_string())?;
        set_generic_password(SERVICE, ACCOUNT, &bytes)
            .map_err(|e| format!("Could not save the Google sign-in to the Keychain: {e}"))
    }
    pub fn delete() -> Result<(), String> {
        match delete_generic_password(SERVICE, ACCOUNT) {
            Ok(()) => Ok(()),
            Err(e) if e.code() == NOT_FOUND => Ok(()),
            Err(e) => Err(format!("Could not remove the Google sign-in from the Keychain: {e}")),
        }
    }
}
#[cfg(not(target_os = "macos"))]
mod keychain {
    use super::Credentials;
    pub const SUPPORTED: bool = false;
    pub fn load() -> Result<Option<Credentials>, String> {
        Ok(None)
    }
    pub fn save(_: &Credentials) -> Result<(), String> {
        Err("Google Calendar sign-in works in the Mac app only.".into())
    }
    pub fn delete() -> Result<(), String> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn pkce_matches_the_rfc_7636_example() {
        assert_eq!(
            challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
        let v = b64(&random(32).unwrap());
        assert_eq!(v.len(), 43);
        assert!(v.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
    }

    #[test]
    fn the_consent_url_asks_only_for_read_only_calendar_access_offline() {
        let url = auth_url("abc.apps.googleusercontent.com", "http://127.0.0.1:5555", "CH", "ST");
        assert!(url.starts_with("https://accounts.google.com/o/oauth2/v2/auth?"));
        for part in [
            "client_id=abc.apps.googleusercontent.com",
            "redirect_uri=http%3A%2F%2F127.0.0.1%3A5555",
            "scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fcalendar.readonly",
            "code_challenge=CH",
            "code_challenge_method=S256",
            "state=ST",
            "access_type=offline",
        ] {
            assert!(url.contains(part), "{part} missing from {url}");
        }
    }

    #[test]
    fn the_redirect_is_checked_against_its_state() {
        assert_eq!(
            parse_callback("GET /?state=s1&code=4%2Fabc&scope=x HTTP/1.1", "s1").unwrap(),
            Callback::Code("4/abc".into())
        );
        assert_eq!(
            parse_callback("GET /?error=access_denied&state=s1 HTTP/1.1", "s1").unwrap(),
            Callback::Denied("access_denied".into())
        );
        assert_eq!(parse_callback("GET /favicon.ico HTTP/1.1", "s1").unwrap(), Callback::Other);
        assert_eq!(parse_callback("", "s1").unwrap(), Callback::Other);
        assert!(parse_callback("GET /?state=other&code=x HTTP/1.1", "s1").is_err());
        assert!(parse_callback("GET /?state=s1 HTTP/1.1", "s1").is_err());
    }

    #[test]
    fn events_parse_into_radar_items() {
        let page = json!({
            "nextPageToken": "p2",
            "items": [
                {"id": "a", "summary": " Launch ", "start": {"dateTime": "2026-11-23T09:00:00Z"}, "end": {"dateTime": "2026-11-23T10:00:00Z"}},
                {"id": "b", "summary": "Holiday", "start": {"date": "2026-11-24"}, "end": {"date": "2026-11-25"}},
                {"id": "c", "status": "cancelled", "summary": "Gone", "start": {"date": "2026-11-24"}},
                {"id": "d", "start": {"dateTime": "2026-11-25T12:00:00+01:00"}},
                {"summary": "No id", "start": {"date": "2026-11-24"}}
            ]
        });
        let (items, next) = parse_events(&page, "me@example.com", "Work");
        assert_eq!(next.as_deref(), Some("p2"));
        assert_eq!(items.len(), 3);
        assert_eq!(items[0].title, "Launch");
        assert_eq!(items[0].id, "google:me@example.com:a");
        assert_eq!(items[0].date, 1_795_424_400_000);
        assert_eq!(items[0].end, Some(1_795_428_000_000));
        assert!(!items[0].all_day);
        assert_eq!(items[0].source, "Work");
        let day = NaiveDate::from_ymd_opt(2026, 11, 24).unwrap();
        assert!(items[1].all_day);
        assert_eq!(items[1].date, local_midnight_ms(day).unwrap());
        assert_eq!(items[1].end, Some(local_midnight_ms(day.succ_opt().unwrap()).unwrap() - 1000));
        assert_eq!(items[2].title, "(No title)");
        assert_eq!(items[2].date, 1_795_604_400_000);
    }

    #[test]
    fn calendars_skip_hidden_ones_and_prefer_the_users_own_name() {
        let list = json!({"items": [
            {"id": "me@example.com", "summary": "me@example.com", "summaryOverride": "Personal", "primary": true},
            {"id": "team", "summary": "Team"},
            {"id": "hidden", "summary": "Hidden", "hidden": true}
        ]});
        assert_eq!(
            parse_calendars(&list),
            vec![
                Calendar { id: "me@example.com".into(), name: "Personal".into(), primary: true },
                Calendar { id: "team".into(), name: "Team".into(), primary: false },
            ]
        );
    }

    #[test]
    fn merging_drops_events_already_read_from_macos_calendar() {
        let item = |id: &str, title: &str, date: i64| RadarItem {
            id: id.into(),
            title: title.into(),
            date,
            end: None,
            all_day: false,
            source: "Work".into(),
            kind: ItemKind::Event,
        };
        let merged = merge(
            vec![item("ek1", "Launch", 10)],
            vec![item("g1", "launch ", 10), item("g2", "Launch", 20), item("g3", "Review", 10)],
        );
        assert_eq!(merged.iter().map(|i| i.id.as_str()).collect::<Vec<_>>(), ["ek1", "g2", "g3"]);
    }

    #[test]
    fn times_are_sent_as_utc_rfc3339() {
        assert_eq!(rfc3339(1_795_424_400_000), "2026-11-23T09:00:00Z");
        assert!(!status().connected || keychain::SUPPORTED);
    }
}
