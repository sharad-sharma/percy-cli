import { resourceFromText, styleSheetFromNode, handleErrors } from './utils';
import { uid } from './prepare-dom';

// Returns true if a stylesheet is a CSSOM-based stylesheet.
function isCSSOM(styleSheet) {
  // no href, has a rulesheet, and has an owner node
  return !styleSheet.href && styleSheet.cssRules && styleSheet.ownerNode;
}

// Returns false if any stylesheet rules do not match between two stylesheets
function styleSheetsMatch(sheetA, sheetB) {
  for (let i = 0; i < sheetA.cssRules.length; i++) {
    let ruleA = sheetA.cssRules[i].cssText;
    let ruleB = sheetB.cssRules[i]?.cssText;
    if (ruleA !== ruleB) return false;
  }

  return true;
}

function createStyleResource(styleSheet) {
  const styles = Array.from(styleSheet.cssRules)
    .map(cssRule => cssRule.cssText).join('\n');
  let resource = resourceFromText(uid(), 'text/css', styles);
  return resource;
}

export function serializeExternalStyles(ctx) {
  let { dom, clone, warnings } = ctx;
  let styleSheets = null;
  try {
    styleSheets = dom.styleSheets;
  } catch {
    warnings.add('Skipping `styleSheets` as it is not supported.');
  }
  if (styleSheets) {
    for (let styleSheet of styleSheets) {
      if (isCSSOM(styleSheet) || styleSheet.href?.startsWith('blob:')) {
        continue;
      } else if (styleSheet.href) {
        let corsAccessible = false;
        try {
          if (styleSheet.cssRules) corsAccessible = true;
        } catch (err) {
          // Not CORS accessible
        }
        if (corsAccessible) {
          try {
            let styleTag = document.createElement('style');
            styleTag.type = 'text/css';
            styleTag.innerHTML = Array.from(styleSheet.cssRules)
              .map(cssRule => cssRule.cssText).join('\n');
            clone.head.appendChild(styleTag);

            const styleLinkId = styleSheet.ownerNode.getAttribute('data-percy-element-id');
            const clonedOldStyleLink = clone.querySelector(`[data-percy-element-id="${styleLinkId}"]`);
            clonedOldStyleLink.remove();
          } catch (err) {
            handleErrors(err, 'Error serializing external stylesheet: ', null, {
              stylesheetHref: styleSheet.href
            });
          }
        }
      }
    }
  }
}

export function serializeCSSOM(ctx) {
  let { dom, clone, resources, cache, warnings } = ctx;
  // in-memory CSSOM into their respective DOM nodes.
  let styleSheets = null;
  // catch error in case styleSheets property is not available (overwritten to throw error)
  try {
    styleSheets = dom.styleSheets;
  } catch {
    warnings.add('Skipping `styleSheets` as it is not supported.');
  }
  if (styleSheets) {
    for (let styleSheet of styleSheets) {
      if (isCSSOM(styleSheet)) {
        let styleId;
        let cloneOwnerNode;
        try {
          styleId = styleSheet.ownerNode.getAttribute('data-percy-element-id');
          cloneOwnerNode = clone.querySelector(`[data-percy-element-id="${styleId}"]`);
          if (styleSheetsMatch(styleSheet, styleSheetFromNode(cloneOwnerNode))) continue;
          let style = document.createElement('style');

          style.type = 'text/css';
          style.setAttribute('data-percy-element-id', styleId);
          style.setAttribute('data-percy-cssom-serialized', 'true');
          style.innerHTML = Array.from(styleSheet.cssRules)
            .map(cssRule => cssRule.cssText).join('\n');

          cloneOwnerNode.parentNode.insertBefore(style, cloneOwnerNode.nextSibling);
          cloneOwnerNode.remove();
        } catch (err) {
          handleErrors(err, 'Error serializing stylesheet: ', cloneOwnerNode, {
            styleId: styleId
          });
        }
      } else if (styleSheet.href?.startsWith('blob:')) {
        try {
          const styleLink = document.createElement('link');
          styleLink.setAttribute('rel', 'stylesheet');
          let resource = createStyleResource(styleSheet);
          resources.add(resource);

          styleLink.setAttribute('data-percy-blob-stylesheets-serialized', 'true');
          styleLink.setAttribute('data-percy-serialized-attribute-href', resource.url);

          /* istanbul ignore next: tested, but coverage is stripped */
          if (clone.constructor.name === 'HTMLDocument' || clone.constructor.name === 'DocumentFragment') {
            // handle document and iframe
            clone.body.prepend(styleLink);
          } else if (clone.constructor.name === 'ShadowRoot') {
            clone.prepend(styleLink);
          }
        } catch (err) {
          handleErrors(err, 'Error serializing stylesheet from blob: ', null, {
            stylesheetHref: styleSheet.href
          });
        }
      }
    }
  }

  // clone Adopted Stylesheets
  // Regarding ordering of the adopted stylesheets - https://github.com/WICG/construct-stylesheets/issues/93
  /* istanbul ignore next: tested, but coverage is stripped */
  if (dom.adoptedStyleSheets && dom.adoptedStyleSheets.length >= 0) {
    for (let sheet of dom.adoptedStyleSheets) {
      const styleLink = document.createElement('link');
      styleLink.setAttribute('rel', 'stylesheet');

      if (!cache.has(sheet)) {
        let resource = createStyleResource(sheet);
        resources.add(resource);
        cache.set(sheet, resource.url);
      }
      styleLink.setAttribute('data-percy-adopted-stylesheets-serialized', 'true');
      styleLink.setAttribute('data-percy-serialized-attribute-href', cache.get(sheet));

      /* istanbul ignore next: tested, but coverage is stripped */
      if (clone.constructor.name === 'HTMLDocument' || clone.constructor.name === 'DocumentFragment') {
        // handle document and iframe
        clone.body.prepend(styleLink);
      } else if (clone.constructor.name === 'ShadowRoot') {
        clone.prepend(styleLink);
      }
    }
  } else {
    warnings.add('Skipping `adoptedStyleSheets` as it is not supported.');
  }
}

export default serializeCSSOM;
