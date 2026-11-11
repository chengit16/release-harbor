-- 在线产物占用由同一空间事务串行维护；内部对象位置只保存在控制面。
CREATE TABLE rh_hosted.artifacts (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  application_id uuid NOT NULL,
  id uuid NOT NULL,
  request_id uuid NOT NULL,
  file_name text NOT NULL,
  size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 268435456),
  manifest text[] NOT NULL,
  object_key text NOT NULL UNIQUE,
  upload_id text NOT NULL,
  object_version text,
  status text NOT NULL CHECK (status IN ('receiving', 'awaiting_check', 'cancelled', 'removed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  received_at timestamptz,
  PRIMARY KEY (workspace_id, project_id, application_id, id),
  UNIQUE (workspace_id, project_id, application_id, request_id),
  FOREIGN KEY (workspace_id, project_id, application_id)
    REFERENCES rh_hosted.applications(workspace_id, project_id, id),
  CHECK ((status IN ('awaiting_check', 'removed')) =
         (object_version IS NOT NULL AND received_at IS NOT NULL))
);
CREATE INDEX hosted_artifact_expiry ON rh_hosted.artifacts (expires_at) WHERE status = 'receiving';
CREATE INDEX hosted_artifact_retention ON rh_hosted.artifacts (received_at) WHERE status = 'awaiting_check';

-- 后续执行器／计划在相同空间锁内登记引用，回收不依赖浏览器声明。
CREATE TABLE rh_hosted.artifact_holds (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  application_id uuid NOT NULL,
  artifact_id uuid NOT NULL,
  hold_id uuid NOT NULL,
  PRIMARY KEY (workspace_id, project_id, application_id, artifact_id, hold_id),
  FOREIGN KEY (workspace_id, project_id, application_id, artifact_id)
    REFERENCES rh_hosted.artifacts(workspace_id, project_id, application_id, id)
);
