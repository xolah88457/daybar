//! Seconds since the last keyboard, mouse or trackpad event, from macOS Core Graphics.
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

#[cfg(not(target_os = "macos"))]
pub fn idle_seconds() -> Option<f64> {
    None
}
