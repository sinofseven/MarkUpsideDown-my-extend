use serde::Serialize;
use std::process::Command;

// --- Cloudflare Markdown for Agents ---

#[derive(Serialize)]
pub struct MarkdownResponse {
    pub body: String,
    pub token_count: Option<u64>,
    pub is_markdown: bool,
}

#[tauri::command]
pub async fn fetch_url_as_markdown(url: String) -> Result<MarkdownResponse, String> {
    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .header("Accept", "text/markdown")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let token_count = response
        .headers()
        .get("x-markdown-tokens")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<u64>().ok());

    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    let body = response.text().await.map_err(|e| e.to_string())?;

    Ok(MarkdownResponse {
        body,
        token_count,
        is_markdown: content_type.contains("text/markdown"),
    })
}

// --- GitHub via gh CLI ---

#[tauri::command]
pub async fn github_fetch_issue(owner: String, repo: String, number: u64) -> Result<String, String> {
    let output = Command::new("gh")
        .args(["issue", "view", &number.to_string()])
        .args(["--repo", &format!("{owner}/{repo}")])
        .args(["--json", "body"])
        .args(["--jq", ".body"])
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[tauri::command]
pub async fn github_fetch_pr(owner: String, repo: String, number: u64) -> Result<String, String> {
    let output = Command::new("gh")
        .args(["pr", "view", &number.to_string()])
        .args(["--repo", &format!("{owner}/{repo}")])
        .args(["--json", "body"])
        .args(["--jq", ".body"])
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[tauri::command]
pub async fn github_list_repos() -> Result<Vec<String>, String> {
    let output = Command::new("gh")
        .args(["repo", "list", "--json", "nameWithOwner", "--jq", ".[].nameWithOwner"])
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    let repos = String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();

    Ok(repos)
}
