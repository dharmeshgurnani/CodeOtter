// Account type on users: owner (everything), admin (everything except accounts and sign-in configuration),
// developer (reserved, not built yet). The first account to sign in becomes owner.
migrate(
  (app) => {
    const c = app.findCollectionByNameOrId("users");
    c.fields.add(new SelectField({ name: "role", values: ["owner", "admin", "developer"], maxSelect: 1 }));
    app.save(c);
  },
  (app) => {
    const c = app.findCollectionByNameOrId("users");
    c.fields.removeByName("role");
    app.save(c);
  },
);
