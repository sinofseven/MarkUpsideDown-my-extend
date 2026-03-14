# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 0.1.x   | Yes       |

Only the latest release is supported with security updates.

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, use [GitHub Security Advisories](https://github.com/M-Igashi/MarkUpsideDown/security/advisories/new) to report vulnerabilities privately.

Please include:

- A description of the vulnerability
- Steps to reproduce the issue
- Affected versions
- Any potential impact

You should receive an initial response within 7 days. Once the issue is confirmed, a fix will be released as soon as possible.

## Scope

This project is a desktop Markdown editor built with Tauri v2. Areas of particular security concern include:

- **Tauri IPC**: Commands exposed between the frontend and Rust backend
- **Markdown rendering**: XSS via crafted Markdown input
- **File system access**: Reading/writing files through Tauri APIs
- **External content**: Fetching and rendering remote resources
