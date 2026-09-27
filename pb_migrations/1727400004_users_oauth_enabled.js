// Sign-in through GitHub is enabled on the users collection; the provider itself (client id + secret) is configured
// at runtime from Admin → OAuth, never in a migration.
migrate(
  (app) => {
    const c = app.findCollectionByNameOrId("users");
    c.oauth2.enabled = true;
    app.save(c);
  },
  (app) => {
    const c = app.findCollectionByNameOrId("users");
    c.oauth2.enabled = false;
    app.save(c);
  },
);
