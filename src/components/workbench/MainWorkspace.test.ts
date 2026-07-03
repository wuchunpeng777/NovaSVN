import { describe, expect, it } from "vitest";

import { unityGroupLabel } from "../../lib/unity";
import type { UnityGroupRules } from "../../types/app";

const defaultRules: UnityGroupRules = {
  addressables: true,
  projectSettings: true,
  packages: true,
  scenes: true,
  prefabs: true,
  assets: true,
};

describe("unityGroupLabel", () => {
  it("groups root-level Addressables paths before generic Assets", () => {
    expect(
      unityGroupLabel("Assets/AddressableAssetsData/Android/settings.json", defaultRules),
    ).toBe("Addressables");
    expect(unityGroupLabel("Assets/Addressables/UI/button.prefab", defaultRules)).toBe(
      "Addressables",
    );
    expect(unityGroupLabel("Assets/Textures/stone.png", defaultRules)).toBe("Assets");
  });

  it("respects disabled Addressables grouping", () => {
    expect(
      unityGroupLabel("Assets/AddressableAssetsData/Android/settings.json", {
        ...defaultRules,
        addressables: false,
      }),
    ).toBe("Assets");
  });
});
