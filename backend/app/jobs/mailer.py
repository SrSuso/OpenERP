"""The only place that opens an SMTP connection.

Deliberately synchronous (stdlib ``smtplib``) — this is called exclusively
from ``app.jobs.worker``'s own loop and from the manual
``POST /outbox/run`` debug endpoint, both of which push it onto a thread
(``asyncio.to_thread``) rather than block the event loop. It is never
called from a request handler that also touches a sale (rule 10).
"""

from __future__ import annotations

import smtplib
from email.message import EmailMessage

from app.core.config import Settings


def send_email(settings: Settings, *, to_email: str, subject: str, body_text: str) -> None:
    message = EmailMessage()
    message["From"] = settings.smtp_from_email
    message["To"] = to_email
    message["Subject"] = subject
    message.set_content(body_text)

    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as smtp:
        if settings.smtp_use_tls:
            smtp.starttls()
        if settings.smtp_username:
            smtp.login(settings.smtp_username, settings.smtp_password or "")
        smtp.send_message(message)
