---
status: partial
phase: 07-notifications
source: docs/superpowers/specs/2026-04-14-notifications-design.md
started: 2026-04-14T12:00:00Z
updated: 2026-04-14T23:47:00Z
---

## Current Test

[testing paused — 15 items blocked by infrastructure]

## Tests

### 1. Notification Bell & Real-Time Badge
expected: Bell icon in sidebar shows unread count. After triggering a notification, badge updates within ~3s (SSE). Clicking bell shows dropdown with last 5 notifications, unread dots, "Mark all read", and "View all" link.
result: pass

### 2. Notification Center Page
expected: Navigate to /notifications. Full page list with filter tabs: All, Unread, Cases, Billing, Team, Calendar. Notifications show title, body, relative time, action link, read/unread indicator. Paginated with infinite scroll.
result: pass

### 3. Mark Single Notification as Read
expected: Click on an unread notification in the list. It transitions to read state (visual indicator changes). Badge count decrements.
result: pass

### 4. Mark All Notifications as Read
expected: Click "Mark all read" button. All unread notifications transition to read state. Badge count goes to 0.
result: pass

### 5. Soft-Deleted Notifications Hidden
expected: Delete a notification. It disappears from the list and does not reappear on refresh. Badge count adjusts if it was unread.
result: pass

### 6. Notification Preferences Matrix
expected: Navigate to /settings/notifications. Matrix UI shows 16 notification types grouped by category (Cases, Billing, Team, Calendar) as rows, and 3 channels (In-app, Email, Push) as columns. Toggle switches for each cell. All default to ON. "Member invited" has In-app/Push disabled (email-only).
result: pass

### 7. Toggle Preference OFF and Verify
expected: Disable email channel for "case_ready" type. Trigger a case_ready notification. In-app notification appears but no email is sent (check Resend logs). Re-enable — email resumes.
result: blocked
blocked_by: third-party
reason: "Requires Inngest dev server running to trigger notification fan-out and Resend for email delivery verification"

### 8. Reset Preferences to Defaults
expected: Change some preferences, then click "Reset to defaults". All toggles return to ON state.
result: pass

### 9. Case Mute Button
expected: Open a case detail page. "Mute" button visible in case header. Click it — button changes to "Muted". Trigger a notification for that case — no notification appears. Click "Muted" to unmute — notifications resume.
result: pass

### 10. Muted Cases List in Settings
expected: After muting a case, navigate to /settings/notifications. Muted cases section at bottom shows the muted case with an "Unmute" button. Click Unmute — case is unmuted.
result: pass

### 11. SSE Real-Time Delivery
expected: Open the app in a browser tab. Trigger a notification from another source (e.g. Inngest dev server). Notification appears in bell dropdown within ~3 seconds without page refresh.
result: pass

### 12. SSE Auto-Reconnect
expected: SSE connection drops (e.g. server restart or network interruption). Within ~3 seconds, EventSource auto-reconnects. Notifications continue to appear in real-time after reconnection.
result: blocked
blocked_by: server
reason: "Requires manually dropping SSE connection and observing reconnect behavior — not automatable via Playwright"

### 13. Push Permission Prompt
expected: Navigate to /settings/notifications. If push not yet enabled, "Enable Push Notifications?" prompt appears with explanation text. Clicking triggers browser Notification.requestPermission() dialog.
result: pass

### 14. Web Push Notification Received
expected: Grant push permission and subscribe. Close or background the browser tab. Trigger a notification. Browser push notification appears with title, body, and icon.
result: blocked
blocked_by: third-party
reason: "Requires VAPID keys configured and Inngest handle-notification running for push delivery"

### 15. Push Notification Click Opens URL
expected: Click on a received push notification. Browser opens/focuses the app and navigates to the correct action URL (e.g. /cases/{id}).
result: blocked
blocked_by: third-party
reason: "Depends on push notification delivery (test 14)"

### 16. Service Worker Registration
expected: Open browser DevTools > Application > Service Workers. sw.js is registered and active. No console errors related to service worker.
result: blocked
blocked_by: other
reason: "Playwright MCP cannot inspect DevTools > Application panel for SW registration status"

### 17. Case Ready Notification
expected: Upload a document and trigger case analysis. On completion, in-app notification "Case analysis complete" appears. Email with case details sent to case creator (check Resend logs).
result: blocked
blocked_by: server
reason: "Requires Inngest dev server running case-analyze function with notification emit"

### 18. Stage Change Notification
expected: Change a case's stage. All case members receive in-app notification with old and new stage names. Email sent per preferences.
result: blocked
blocked_by: server
reason: "Requires Inngest dev server for handle-notification fan-out"

### 19. Task Assignment Notification
expected: Assign a task to a user (via toggleAssign or update). Assignee receives in-app notification "New task assigned: {taskTitle}".
result: blocked
blocked_by: server
reason: "Requires Inngest dev server for handle-notification fan-out"

### 20. Task Completed Notification
expected: Mark a task as done. Case lead (or case creator if no lead) receives in-app notification "Task completed: {taskTitle}".
result: blocked
blocked_by: server
reason: "Requires Inngest dev server for handle-notification fan-out"

### 21. Team Member Invited (Email-Only)
expected: Send a team invite. Invitee receives email "You've been invited to {orgName}" at their email address. No in-app notification (user doesn't exist yet).
result: blocked
blocked_by: third-party
reason: "Requires Inngest + Resend for email-only notification delivery"

### 22. Team Member Joined Notification
expected: New member accepts invite (Clerk webhook fires). Org admins receive in-app notification "{memberName} joined your team".
result: blocked
blocked_by: third-party
reason: "Requires Clerk webhook trigger (organizationMembership.created)"

### 23. Added to Case Notification
expected: Add a member to a case. New member receives in-app notification "You've been added to {caseName}".
result: blocked
blocked_by: server
reason: "Requires Inngest dev server for handle-notification fan-out"

### 24. Event Reminder Notification
expected: Create a calendar event 15min from now. Reminder cron (every 5min) picks it up and sends notification. No duplicate reminder sent on next cron run (dedup_key prevents it).
result: blocked
blocked_by: server
reason: "Requires Inngest cron function (notification-reminders) running"

### 25. Invoice Overdue Notification
expected: Create an invoice with past due date (status=sent). Daily 9:00 cron fires notification "Invoice {number} is overdue". No duplicate next day (dedup_key with date).
result: blocked
blocked_by: server
reason: "Requires Inngest cron function (notification-overdue-check) running"

### 26. Task Overdue Notification
expected: Create a task with past due date (status!=done). Daily 9:00 cron fires notification "Task overdue: {taskTitle}".
result: blocked
blocked_by: server
reason: "Requires Inngest cron function (notification-overdue-check) running"

## Summary

total: 26
passed: 11
issues: 0
pending: 0
skipped: 0
blocked: 15

## Gaps

[none yet]
