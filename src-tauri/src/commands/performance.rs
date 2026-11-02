use super::{decoded, encoded};
use crate::{
    models::*,
    process::{cancellation, Cancel},
    service::Service,
};
use serde_json::Value;

impl Service {
    pub(crate) fn performance_command(
        &self,
        _app: &tauri::AppHandle,
        method: &str,
        args: Value,
        _cancel: Cancel,
    ) -> Result<Value> {
        match method {
            "startPerformance" => {
                let (target,): (Target,) = decoded(args)?;
                encoded(self.performance.start(self.adb(cancellation())?, target)?)
            }
            "samplePerformance" => {
                let (id, package): (String, String) = decoded(args)?;
                encoded(self.performance.sample(&id, &package)?)
            }
            "stopPerformance" => {
                let (id,): (String,) = decoded(args)?;
                self.performance.stop(&id);
                Ok(Value::Null)
            }
            _ => Err("不支持的操作。".into()),
        }
    }
}
