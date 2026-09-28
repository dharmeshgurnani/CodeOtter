export type SeoMeta = {
  title: string;
  description: string;
  url?: string;
  image?: string;
  type?: string;
};

function setMetaTag(attr: "name" | "property", key: string, content: string) {
  if (typeof document === "undefined") return;
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function setCanonical(url: string) {
  if (typeof document === "undefined") return;
  let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!link) {
    link = document.createElement("link");
    link.setAttribute("rel", "canonical");
    document.head.appendChild(link);
  }
  link.setAttribute("href", url);
}

export function updateSeo({ title, description, url, image, type = "website" }: SeoMeta) {
  if (typeof document === "undefined") return;
  const fullTitle = title.includes("CodeOtter") ? title : `${title} · CodeOtter`;
  const cleanDesc = description.replace(/\s+/g, " ").trim().slice(0, 220);
  const pageUrl = url || (typeof location !== "undefined" ? location.href : "");
  const ogImg =
    image ||
    (typeof location !== "undefined"
      ? `${location.origin}/og.svg?title=${encodeURIComponent(title)}&sub=${encodeURIComponent(cleanDesc.slice(0, 110))}`
      : "/og.svg");

  document.title = fullTitle;
  setMetaTag("name", "description", cleanDesc);
  setMetaTag("property", "og:site_name", "CodeOtter");
  setMetaTag("property", "og:type", type);
  setMetaTag("property", "og:title", fullTitle);
  setMetaTag("property", "og:description", cleanDesc);
  if (pageUrl) {
    setMetaTag("property", "og:url", pageUrl);
    setCanonical(pageUrl);
  }
  setMetaTag("property", "og:image", ogImg);
  setMetaTag("name", "twitter:card", "summary_large_image");
  setMetaTag("name", "twitter:title", fullTitle);
  setMetaTag("name", "twitter:description", cleanDesc);
  setMetaTag("name", "twitter:image", ogImg);
}
