export interface ServerConfig {
  id: string;
  label: string;
  queryUrl: string
  backendUrl?: string; // Optional: base URL of the self-hosted game-server backend (e.g. http://localhost:3001)
  public: boolean;
  createdAt: Date;
  userId?: string; // for backend-server with login, every user should have own server-list
}
