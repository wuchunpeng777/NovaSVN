const AUTO_TOOLTIP_ATTRIBUTE = "data-auto-button-tooltip";
const TOOLTIP_TARGET_SELECTOR = 'button, [role="button"]';
const AUTO_TOOLTIP_TARGET_SELECTOR =
  `button[${AUTO_TOOLTIP_ATTRIBUTE}], [role="button"][${AUTO_TOOLTIP_ATTRIBUTE}]`;

function tooltipText(target: HTMLElement) {
  const text = target.getAttribute("aria-label") ?? target.textContent ?? "";
  return text.replace(/\s+/g, " ").trim();
}

function setAttributeIfChanged(element: HTMLElement, name: string, value: string) {
  if (element.getAttribute(name) !== value) {
    element.setAttribute(name, value);
  }
}

function syncButtonTooltip(target: HTMLElement) {
  const generatedTitle = target.getAttribute(AUTO_TOOLTIP_ATTRIBUTE);
  const currentTitle = target.getAttribute("title");

  if (generatedTitle === null && currentTitle?.trim()) {
    return;
  }

  if (generatedTitle !== null && currentTitle !== generatedTitle) {
    target.removeAttribute(AUTO_TOOLTIP_ATTRIBUTE);
    if (currentTitle?.trim()) {
      return;
    }
  }

  const text = tooltipText(target);
  if (!text) {
    if (target.getAttribute("title") === generatedTitle) {
      target.removeAttribute("title");
    }
    target.removeAttribute(AUTO_TOOLTIP_ATTRIBUTE);
    return;
  }

  setAttributeIfChanged(target, AUTO_TOOLTIP_ATTRIBUTE, text);
  setAttributeIfChanged(target, "title", text);
}

function addTargetsFromNode(node: Node, targets: Set<HTMLElement>) {
  if (!(node instanceof Element)) {
    return;
  }
  if (node instanceof HTMLElement && node.matches(TOOLTIP_TARGET_SELECTOR)) {
    targets.add(node);
  }
  node
    .querySelectorAll<HTMLElement>(TOOLTIP_TARGET_SELECTOR)
    .forEach((target) => targets.add(target));
}

export function installButtonTooltips(root: Document | HTMLElement = document) {
  root.querySelectorAll<HTMLElement>(TOOLTIP_TARGET_SELECTOR).forEach(syncButtonTooltip);

  const observer = new MutationObserver((mutations) => {
    const targets = new Set<HTMLElement>();

    for (const mutation of mutations) {
      if (
        mutation.target instanceof HTMLElement &&
        mutation.target.matches(TOOLTIP_TARGET_SELECTOR)
      ) {
        targets.add(mutation.target);
      } else if (mutation.target.parentElement?.closest(TOOLTIP_TARGET_SELECTOR)) {
        targets.add(
          mutation.target.parentElement.closest(TOOLTIP_TARGET_SELECTOR) as HTMLElement,
        );
      }
      mutation.addedNodes.forEach((node) => addTargetsFromNode(node, targets));
    }

    targets.forEach(syncButtonTooltip);
  });

  observer.observe(root, {
    attributes: true,
    attributeFilter: ["aria-label", "title"],
    characterData: true,
    childList: true,
    subtree: true,
  });

  return () => {
    observer.disconnect();
    root
      .querySelectorAll<HTMLElement>(AUTO_TOOLTIP_TARGET_SELECTOR)
      .forEach((target) => {
        const generatedTitle = target.getAttribute(AUTO_TOOLTIP_ATTRIBUTE);
        if (target.getAttribute("title") === generatedTitle) {
          target.removeAttribute("title");
        }
        target.removeAttribute(AUTO_TOOLTIP_ATTRIBUTE);
      });
  };
}
