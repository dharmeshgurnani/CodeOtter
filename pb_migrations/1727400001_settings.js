// Key/value settings edited from the app's Settings page (provider, model, API key, base URL).
migrate(
  (app) => {
    const c = new Collection({
      name: "settings",
      type: "base",
      fields: [
        { name: "key", type: "text", required: true },
        { name: "value", type: "json", maxSize: 100000 },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
      indexes: ["CREATE UNIQUE INDEX idx_settings_key ON settings (key)"],
    });
    app.save(c);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("settings"));
  },
);
