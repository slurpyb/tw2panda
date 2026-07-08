// Browser shim for Node's `module` builtin (aliased in vite.config.ts).
//
// tw2panda locates Tailwind v4's CSS assets with
// `createRequire(import.meta.url).resolve("tailwindcss/package.json")`.
// In the browser there is no real module resolution, so we return a virtual
// path that `fs.shim.ts` knows how to serve. `getTailwindDir()` takes the
// dirname of this, i.e. `/node_modules/tailwindcss`, and reads `index.css`
// etc. relative to it.
export const createRequire = () => ({
  resolve: (id: string) => `/node_modules/${id}`,
});

export default { createRequire };
