/** Example bundle for UI/docs (no real secrets). Safe to import from client components. */
export const COMBINED_CREDENTIALS_EXAMPLE = `{
  "gcp": {
    "type": "service_account",
    "project_id": "your-gcp-project",
    "private_key_id": "...",
    "private_key": "-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----\\n",
    "client_email": "your-sa@your-gcp-project.iam.gserviceaccount.com",
    "client_id": "...",
    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
    "token_uri": "https://oauth2.googleapis.com/token",
    "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
    "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/..."
  },
  "pdi": {
    "PDI_USERNAME": "your-pdi-user",
    "PDI_PASSWORD": "your-pdi-password",
    "PDI_API_TOKEN": "your-pdi-api-token"
  }
}`;
