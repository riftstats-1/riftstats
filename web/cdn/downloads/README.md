# Downloads

Filled by the pipeline, not checked in:

- `RiftStats-setup.exe` – the Windows installer, built by `.github/workflows/desktop.yml`
- `latest.json` – version, size and date of that installer, read by the download page

The CI/CD workflow downloads both from the GitHub release `desktop-latest` before it builds the web image.
