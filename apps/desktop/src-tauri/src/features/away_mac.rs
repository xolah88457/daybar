//! Seconds since the last keyboard, mouse or trackpad event: from Core Graphics on macOS and from
//! `GetLastInputInfo` on Windows.
//! Self-contained on purpose (no `crate::` imports) so it can be type-checked on its own.

/// Idle time in seconds, or `None` when it cannot be read (and always on other platforms).
#[cfg(target_os = "macos")]
pub fn idle_seconds() -> Option<f64> {
    // CGEventSourceStateID is an int32 enum; kCGEventSourceStateCombinedSessionState == 0.
    const COMBINED_SESSION_STATE: i32 = 0;
    // CGEventType is a uint32; kCGAnyInputEventType == ~0.
    const ANY_INPUT_EVENT_TYPE: u32 = !0;
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        // CFTimeInterval (double) CGEventSourceSecondsSinceLastEventType(stateID, eventType)
        fn CGEventSourceSecondsSinceLastEventType(state_id: i32, event_type: u32) -> f64;
    }
    // SAFETY: a plain C function taking two integers and returning a double; no pointers involved.
    let seconds = unsafe {
        CGEventSourceSecondsSinceLastEventType(COMBINED_SESSION_STATE, ANY_INPUT_EVENT_TYPE)
    };
    (seconds.is_finite() && seconds >= 0.0).then_some(seconds)
}

#[cfg(windows)]
pub fn idle_seconds() -> Option<f64> {
    use windows_sys::Win32::System::SystemInformation::GetTickCount;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
    let mut info = LASTINPUTINFO {
        cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
        dwTime: 0,
    };
    // SAFETY: `info` is a correctly sized LASTINPUTINFO that lives across the call.
    if unsafe { GetLastInputInfo(&mut info) } == 0 {
        return None;
    }
    // Both are milliseconds since boot in a u32 that wraps every ~49.7 days; wrapping_sub handles it.
    // SAFETY: a plain function with no arguments.
    let now = unsafe { GetTickCount() };
    Some(f64::from(now.wrapping_sub(info.dwTime)) / 1000.0)
}

#[cfg(not(any(target_os = "macos", windows)))]
pub fn idle_seconds() -> Option<f64> {
    None
}
