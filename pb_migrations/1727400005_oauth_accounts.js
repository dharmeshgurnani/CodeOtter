// OAuth identities need not expose a verified email (e.g. Forgejo OIDC).
// PocketBase links them by provider + subject. Never invent or trust an unverified email.
migrate(
  (app) => {
    const c = app.findCollectionByNameOrId("users");
    c.fields.getByName("email").required = false;
    c.passwordAuth.enabled = false;
    c.createRule = '@request.context = "oauth2" && @request.body.role:isset = false';
    c.oauth2.mappedFields.name = "";
    c.oauth2.mappedFields.username = "name";
    app.save(c);
  },
  (app) => {
    const c = app.findCollectionByNameOrId("users");
    c.fields.getByName("email").required = true;
    c.passwordAuth.enabled = true;
    c.createRule = "";
    c.oauth2.mappedFields.name = "name";
    c.oauth2.mappedFields.username = "";
    app.save(c);
  },
);
