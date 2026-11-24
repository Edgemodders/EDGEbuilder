// The About tab's guide: build.mjs turns a .md file into its HTML.
declare module "*.md" {
  const html: string;
  export default html;
}
