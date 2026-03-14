fn main() {
    println!("cargo:rerun-if-changed=../worker/src/index.ts");
    println!("cargo:rerun-if-changed=../worker/wrangler.jsonc");
    tauri_build::build()
}
