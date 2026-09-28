// One collection: a row per reviewed PR. `data` holds the full review JSON the UI renders;
// the other fields are denormalised copies so the admin UI and filters are usable.
migrate(
  (app) => {
    const c = new Collection({
      name: "reviews",
      type: "base",
      fields: [
        { name: "url", type: "text", required: true },
        { name: "repo", type: "text" },
        { name: "number", type: "number" },
        { name: "title", type: "text" },
        { name: "verdict", type: "text" },
        { name: "quality", type: "number" },
        { name: "blast", type: "number" },
        { name: "model", type: "text" },
        { name: "at", type: "date" },
        { name: "data", type: "json", maxSize: 5000000 },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
      indexes: ["CREATE UNIQUE INDEX idx_reviews_url ON reviews (url)"],
    });
    app.save(c);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("reviews"));
  },
);
