// The Explorer's folders (0.14.0), shared by the asset index (Node) and the page: no Node imports here.

/**
 * Where an asset sits in the Explorer: a file by its folders; a person (a `Character` record) in a folder named by
 * the first word of its record, such as `afterlife` for `Character.afterlife_merc_...`.
 */
export function exploreSegments(root: string, assetPath: string): string[] {
  if (root !== "people") return assetPath.split("\\");
  const name = assetPath.replace(/^character\./i, "");
  const cut = name.indexOf("_");
  return cut > 0 ? [name.slice(0, cut).toLowerCase(), assetPath] : [assetPath];
}
