-- 在线目录独占 schema；复合外键确保目录关系不能跨工作空间或父级。
CREATE TABLE rh_hosted.workspaces (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  key text NOT NULL UNIQUE CHECK (key ~ '^[a-z][a-z0-9-]{1,39}$')
);

CREATE TABLE rh_hosted.members (
  workspace_id uuid NOT NULL REFERENCES rh_hosted.workspaces(id),
  id uuid NOT NULL,
  issuer text NOT NULL,
  subject text NOT NULL,
  label text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'operator', 'viewer')),
  PRIMARY KEY (workspace_id, id),
  UNIQUE (workspace_id, issuer, subject)
);
CREATE INDEX hosted_member_identity ON rh_hosted.members (issuer, subject, workspace_id);

-- 登录事务不含 IdP token；会话与绑定浏览器的随机值均只保留摘要。
CREATE TABLE rh_hosted.login_flows (
  digest text PRIMARY KEY,
  state text NOT NULL,
  nonce text NOT NULL,
  verifier text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX hosted_login_expiry ON rh_hosted.login_flows (expires_at);

CREATE TABLE rh_hosted.sessions (
  digest text PRIMARY KEY,
  issuer text NOT NULL,
  subject text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX hosted_session_expiry ON rh_hosted.sessions (expires_at);

CREATE TABLE rh_hosted.projects (
  workspace_id uuid NOT NULL REFERENCES rh_hosted.workspaces(id),
  id uuid NOT NULL,
  name text NOT NULL,
  key text NOT NULL,
  framework text NOT NULL CHECK (framework IN ('react-native', 'flutter', 'native', 'other')),
  description text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id),
  UNIQUE (workspace_id, key)
);

CREATE TABLE rh_hosted.applications (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  id uuid NOT NULL,
  name text NOT NULL,
  platform text NOT NULL CHECK (platform = 'android'),
  identifier text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, project_id, id),
  FOREIGN KEY (workspace_id, project_id) REFERENCES rh_hosted.projects(workspace_id, id),
  UNIQUE (workspace_id, platform, identifier)
);

CREATE TABLE rh_hosted.bindings (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  application_id uuid NOT NULL,
  id uuid NOT NULL,
  channel text NOT NULL CHECK (channel = 'huawei'),
  app_id text NOT NULL CHECK (app_id ~ '^[0-9]+$'),
  credential_reference text NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, project_id, application_id, id),
  FOREIGN KEY (workspace_id, project_id, application_id)
    REFERENCES rh_hosted.applications(workspace_id, project_id, id),
  UNIQUE (workspace_id, project_id, application_id, channel),
  UNIQUE (workspace_id, channel, app_id)
);
