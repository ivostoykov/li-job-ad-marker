(function () {
  const AI_SEARCH_ROOT_SELECTOR =
    'main div[componentkey="SearchResultsMainContent"]';
  const AI_SEARCH_CARD_SELECTOR =
    'div[role="button"][componentkey], a[componentkey][href*="currentJobId="]';

  function extractAiJobIdFromReact(card) {
    const reactFiberKey = Object.keys(card || {}).find((key) =>
      key.startsWith("__reactFiber"),
    );
    const triggerText = reactFiberKey
      ? JSON.stringify(
          card[reactFiberKey]?.return?.return?.memoizedProps?.triggers || [],
        )
      : "";
    const triggerMatch =
      triggerText.match(/JobCardFrameworkImpl(?:ViewedState|FooterState)_(\d+)/) ||
      triggerText.match(
        /JobSearchResultsPage_CompanyFocusTargetJobIdBindingKey_(\d+)/,
      ) ||
      triggerText.match(/"stringValue":"(\d{7,})"/);
    return triggerMatch?.[1] || null;
  }

  function annotateAiCards() {
    const root = document.querySelector(AI_SEARCH_ROOT_SELECTOR);
    if (!root) return;

    root.querySelectorAll(AI_SEARCH_CARD_SELECTOR).forEach((card) => {
      if (card.getAttribute("data-ljm-job-id")) return;
      const jobId = extractAiJobIdFromReact(card);
      if (jobId) {
        card.setAttribute("data-ljm-job-id", jobId);
      }
    });
  }

  if (!window.__ljmUrlBridgeInstalled) {
    window.__ljmUrlBridgeInstalled = true;

    let lastHref = location.href;

    const dispatchUrlChange = (source) => {
      if (location.href === lastHref) return;
      lastHref = location.href;
      document.dispatchEvent(
        new CustomEvent("ljm:urlchange", {
          detail: {
            source,
            href: location.href,
            pathname: location.pathname,
            search: location.search,
            hash: location.hash,
          },
        }),
      );
    };

    const originalPushState = history.pushState.bind(history);
    history.pushState = function (...args) {
      const result = originalPushState(...args);
      dispatchUrlChange("history.pushState");
      return result;
    };

    const originalReplaceState = history.replaceState.bind(history);
    history.replaceState = function (...args) {
      const result = originalReplaceState(...args);
      dispatchUrlChange("history.replaceState");
      return result;
    };

    window.addEventListener("popstate", () => dispatchUrlChange("popstate"));
    window.addEventListener("hashchange", () => dispatchUrlChange("hashchange"));

    const observer = new MutationObserver(() => {
      annotateAiCards();
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["componentkey"],
    });
    annotateAiCards();
  }

  if (window.ljmDebugSnapshot) return;

  window.ljmDebugSnapshot = function ljmDebugSnapshot() {
    const aiRoot = document.querySelector(
      'main div[componentkey="SearchResultsMainContent"]',
    );
    const aiCards = aiRoot
      ? [
          ...aiRoot.querySelectorAll(
            'div[role="button"][componentkey], a[componentkey][href*="currentJobId="]',
          ),
        ].filter((card) => {
          if (card.getAttribute("data-ljm-job-id")) return true;
          if (card.matches('a[href*="currentJobId="]')) return true;
          if (card.matches('a[href*="/jobs/view/"]')) return true;
          if (card.querySelector('a[href*="currentJobId="]')) return true;
          if (card.querySelector('a[href*="/jobs/view/"]')) return true;
          return false;
        })
      : [];
    const firstAiCard = aiCards[0] || null;
    const firstClassicCard = document.querySelector(
      ".job-card-container--clickable",
    );
    const classicCards = document.querySelectorAll(
      ".job-card-container",
    ).length;

    return {
      href: location.href,
      pathname: location.pathname,
      search: location.search,
      title: document.title,
      urlChangeCount:
        document.documentElement.getAttribute("data-ljm-url-change-count") ||
        null,
      lastUrlChangeSource:
        document.documentElement.getAttribute("data-ljm-url-change-source") ||
        null,
      lastObservedHref:
        document.documentElement.getAttribute("data-ljm-last-observed-href") ||
        null,
      colourStylePresent: !!document.getElementById("ljm-colours"),
      classicCards,
      aiRootPresent: !!aiRoot,
      aiCards: aiCards.length,
      domSurface: aiRoot
        ? "ai-search-results"
        : classicCards
          ? "default-jobs"
          : null,
      viewedCards: document.querySelectorAll(".ljm-viewed").length,
      appliedCards: document.querySelectorAll(".ljm-applied").length,
      blacklistedCards: document.querySelectorAll(".ljm-blacklisted").length,
      ageingCards: document.querySelectorAll(".ljm-ageing").length,
      unwantedTitleCards: document.querySelectorAll(".ljm-unwanted-title")
        .length,
      detailAgeing: document.querySelectorAll(".ljm-detail-ageing").length,
      detailUnwantedTitle: document.querySelectorAll(
        ".ljm-detail-unwanted-title",
      ).length,
      firstClassicCard: firstClassicCard?.className || null,
      firstAiCard: firstAiCard?.className || null,
      firstAiCardJobId: firstAiCard?.getAttribute("data-ljm-job-id") || null,
    };
  };
})();
