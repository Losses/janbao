# DV08 Architecture Review Report: Android Systems Navigation (Cycle 2)

**Prepared by:** Android Systems Architect
**Target Architecture Proposal:** [docs/DV08-Meeting/DV08-Architecture.md](file:///home/losses/Development/janbao/docs/DV08-Meeting/DV08-Architecture.md)
**Final Decision:** Approve with Conditions

---

## 1. Executive Summary

The Cycle 2 draft of the DV08 Architecture Proposal provides a significantly matured blueprint for resolving Janbao's mobile viewport, scrolling, and navigation behaviors. 

From an Android Systems perspective, the adoption of Alternative A (Independent Scrolling Viewports) aligns with modern app navigation architecture (similar to Jetpack Compose or Fragment-isolated scrolling states). The separation of list-view and detail-view scroll containers solves viewport height collisions and prevents scroll chaining. Furthermore, the 66% database load reduction in the page server load function represents an excellent architectural optimization.

However, while the conceptual models have been integrated, several critical implementation gaps in the Navigation BackStack representation and gesture fallback detection must be addressed. We issue an Approve with Conditions, requiring these gaps to be resolved before or during the implementation phase.

---

## 2. Evaluation of Cycle 1 Conditions

### 2.1 Adopting Independent Scrolling Viewports (Alternative A)
* **Status:** Fully Met
* **Review:** The layout specification in Section 2.2 successfully locks the main document viewport and isolates scrolling to individual pane elements. The usage of overscroll-behavior-y: contain on scroll panes correctly prevents scroll chaining. Setting -webkit-overflow-scrolling: touch ensures native-like momentum scrolling in WebViews.

### 2.2 Virtual Stacks and SvelteKit Lifecycle Sync
* **Status:** Partially Met
* **Review:** The introduction of the global NavigationStore in Section 4.1 is a strong step toward managing tab-isolated history. However, three key correctness issues are present in the provided store design:
  1. **Lack of Lifecycle Initialization:** The store initializes stack arrays with hardcoded tab roots. When a user deep-links directly to a detail route (e.g., /discussion/123/title), the store is instantiated, but the initial URL is never added to the active tab's stack array. SvelteKit's beforeNavigate only runs on subsequent transitions. As a result, the virtual stack becomes out-of-sync with the browser's address bar from the first load.
  2. **No Accessors for Non-Active Tabs:** The virtual stack state (#stacks) is a private field with no public accessors or helper methods for retrieving the topmost URL of other tabs. Without this, Svelte components (such as the bottom navigation bar) cannot implement state restoration (restoreState) when switching between tabs.
  3. **No SvelteKit Registration:** While the store imports SvelteKit beforeNavigate and afterNavigate, it does not actually register its handler methods with SvelteKit's listener functions. The methods exist on the class but are never bound to run.

### 2.3 Fallback Push for Deep-Links
* **Status:** Partially Met
* **Review:** Section 4.2 states that the gesture callback will execute a goto fallback if there is no previous internal history entry. However, the proposal does not specify the mechanism to detect this. Checking window.history.length is unreliable as it includes external referrer history (e.g., Google Search results). The architecture needs a explicit way to determine if a back navigation is safe or requires a fallback push.

### 2.4 Svelte 5 BackHandler Dispatcher for LIFO Back-Actions
* **Status:** Partially Met
* **Review:** The requirement of a central BackHandler dispatcher in Svelte is acknowledged in Section 4.2. However, the proposal provides only a brief textual description. To ensure developer alignment and prevent ad-hoc implementations, the architecture should define the programmatic interface and component-level contract for registering, unregistering, and invoking these callbacks.

---

## 3. Conditions for Full Approval

To transition this architecture to full approval, the following adjustments must be incorporated into the implementation of the navigation system:

### 3.1 Virtual Stack Initialization
The NavigationStore must implement a startup routine (such as in its constructor or an initialize method called on client-side mount) that checks the initial page.url.pathname and populates the appropriate tab stack. For example, if a user deep-links to a discussion detail page, the stack for tab 0 should be initialized as ["/", initialPathName] rather than just ["/"].

### 3.2 Tab-State Restoration API
The NavigationStore must expose a public method or getter to retrieve the top entry of a specific tab's stack. Svelte components should be able to query this to navigate to the correct saved state on tab switches. For example, navigationStore.getTabTop(1) should return the last saved URL for the Activity tab.

### 3.3 Lifecycle Hook Registration
The file navigation.svelte.ts must call SvelteKit's beforeNavigate and afterNavigate functions at the module level to register the store's lifecycle handlers:
* beforeNavigate((nav) => navStoreInstance.handleBeforeNavigate(nav.to?.url.pathname, nav.from?.url.pathname, nav.type))
* afterNavigate(() => navStoreInstance.handleAfterNavigate())

### 3.4 Internal History Detection Mechanism
The application must track whether there is a previous internal history entry using a robust method, such as:
* Checking if window.navigation.entries().length is greater than 1 (where the HTML5 Navigation API is supported).
* Maintaining a simple reactive session navigation counter in the NavigationStore that increments on each non-popstate navigate event. If the counter is 0, the gesture handler knows it must perform a fallback push.

### 3.5 BackHandler Dispatcher API Contract
The BackHandler dispatcher should be explicitly specified with a simple LIFO stack interface. Svelte components should register back-interceptors (e.g., for drawer or modal closures) using a structure similar to:
* register(callback: () => boolean): returns an unregister function.
* dispatch(): returns boolean (true if an interceptor consumed the back event, false if it should bubble up to history.back()).
This dispatcher must be called by the edge-swipe gesture handler before any history navigation is triggered.
