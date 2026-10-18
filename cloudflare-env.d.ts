declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    PLAYBOOK_SETUP_KEY?: string;
    BUCKET?: R2Bucket;
  }
}
