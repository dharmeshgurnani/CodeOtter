// Users may read and update only their own record, and never their own role (roles are set by the owner through
// the app, which uses the superuser token). Nobody deletes accounts through the public API.
migrate(
  (app) => {
    const c = app.findCollectionByNameOrId("users");
    c.listRule = "id = @request.auth.id";
    c.viewRule = "id = @request.auth.id";
    c.updateRule = "id = @request.auth.id && @request.body.role:isset = false";
    c.deleteRule = null;
    app.save(c);
  },
  (app) => {
    const c = app.findCollectionByNameOrId("users");
    c.listRule = "id = @request.auth.id";
    c.viewRule = "id = @request.auth.id";
    c.updateRule = "id = @request.auth.id";
    c.deleteRule = "id = @request.auth.id";
    app.save(c);
  },
);
