const config = {
  default: {
    override: {
      wrapper: "cloudflare-node",
      converter: "edge",
      incrementalCache: "dummy",
      tagCache: "dummy",
      queue: "dummy",
    },
    bundler: {
      external: ["pg-cloudflare"],
    },
  },
};

export default config;
