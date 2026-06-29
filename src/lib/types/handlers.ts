/** Generic void callback with no parameters */
export type VoidHandler = () => void;

/** Mouse event handler callback */
export type MouseEventHandler = (e: MouseEvent) => void;

/** Page-change callback for paginators (the newly selected 1-based page). */
export type PageChangeHandler = (page: number) => void;
