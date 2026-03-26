# CLI Usage

## Setup

After installing MarkUpsideDown, create a symlink so that `markupsidedown` is available in your PATH:

```bash
sudo ln -sf /Applications/MarkUpsideDown.app/Contents/MacOS/MarkUpsideDown /usr/local/bin/markupsidedown
```

## Usage

Open a file:

```bash
markupsidedown README.md
```

Open multiple files as tabs:

```bash
markupsidedown file1.md file2.md notes/todo.md
```

Both absolute and relative paths are supported. If the app is already running, files are opened in the existing window.
