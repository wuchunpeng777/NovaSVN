import type { UnityGroupRules } from "../types/app";

export function unityGroupLabel(path: string, rules: UnityGroupRules) {
  const normalized = path.replaceAll("\\", "/");
  if (
    rules.addressables &&
    (normalized.startsWith("Assets/AddressableAssetsData/") ||
      normalized.startsWith("Assets/Addressables/") ||
      normalized.includes("/AddressableAssetsData/") ||
      normalized.includes("/Addressables/"))
  ) {
    return "Addressables";
  }
  if (rules.projectSettings && normalized.startsWith("ProjectSettings/")) {
    return "ProjectSettings";
  }
  if (rules.packages && normalized.startsWith("Packages/")) {
    return "Packages";
  }
  if (rules.scenes && normalized.endsWith(".unity")) {
    return "Scene";
  }
  if (rules.prefabs && normalized.endsWith(".prefab")) {
    return "Prefab";
  }
  if (rules.assets && normalized.startsWith("Assets/")) {
    return "Assets";
  }
  return "其他";
}
