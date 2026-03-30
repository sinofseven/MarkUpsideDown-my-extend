mod bridge;
mod tools;

use rmcp::ServiceExt;
use rmcp::transport::stdio;

const VERSION: &str = env!("CARGO_PKG_VERSION");

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // --version flag
    if std::env::args().any(|a| a == "--version" || a == "-V") {
        println!("markupsidedown-mcp {VERSION}");
        return Ok(());
    }

    // Log to stderr (stdout is used for MCP protocol)
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive(tracing_subscriber::filter::LevelFilter::WARN.into()),
        )
        .with_writer(std::io::stderr)
        .init();

    let server = tools::McpTools::new();
    let service = server.serve(stdio()).await?;
    service.waiting().await?;
    Ok(())
}
