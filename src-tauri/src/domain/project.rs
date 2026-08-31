use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct Project {
    pub id: Uuid,
    pub name: String,
    pub archived_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl Project {
    pub fn new(name: String) -> Result<Self, crate::error::AppError> {
        let now = Utc::now();

        Ok(Self {
            id: Uuid::new_v4(),
            name: validate_project_name(name)?,
            archived_at: None,
            created_at: now,
            updated_at: now,
        })
    }

    pub fn rename(&mut self, name: String) -> Result<(), crate::error::AppError> {
        self.name = validate_project_name(name)?;
        self.updated_at = Utc::now();

        Ok(())
    }

    pub fn archive(&mut self) {
        let now = Utc::now();
        self.archived_at = Some(now);
        self.updated_at = now;
    }
}

fn validate_project_name(name: String) -> Result<String, crate::error::AppError> {
    let name = name.trim().to_owned();
    if name.is_empty() || name.chars().count() > 120 {
        return Err(crate::error::AppError::new(
            "project.input.invalid",
            "errors.project.input.invalid",
            crate::error::AppErrorKind::Validation,
        ));
    }

    Ok(name)
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[expect(dead_code, reason = "M2 标签管理命令接入前保留标签领域模型")]
pub struct Tag {
    pub id: Uuid,
    pub name: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}
