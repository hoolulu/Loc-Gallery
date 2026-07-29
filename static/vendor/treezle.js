/**
 * Treezle — Reusable TreeView component
 * (c) 2026 Micha Sulman
 * Licensed under the MIT License
 * https://opensource.org/licenses/MIT
 */

/**
 * treezle.js — Treezle TreeView component
 * Pure JS, no dependencies. Designed for OutSystems.
 *
 * ── Node schema (flat, maps to OutSystems Entity) ──────────────────
 * {
 *   id:           string|number,   // PK — Long Integer or string
 *   parentId:     string|number|null,
 *   label:        string,
 *   nodeType:     string,          // e.g. "Container" | "Item"
 *   isReadOnly:   boolean,
 *   isDraggable:  boolean,
 *   isExpanded:   boolean,
 *   isSelected:   boolean,
 *   isDisabled:   boolean,
 *   isVisible:    boolean,
 *   isChecked:    boolean,
 *   showCheckBox: boolean,
 *   cssClass:     string,
 *   icon:         string,
 *   isDropTarget: boolean,         // false = node rejects drops (default: true)
 *   data:         {}               // free JSON payload
 * }
 *
 * ── Options schema ─────────────────────────────────────────────────
 * {
 *   multiSelect:       boolean,
 *   allowInlineRename: boolean,
 *   indentPx:          number,
 *   showIcons:         boolean,
 *   showCheckBoxes:    boolean,    // global — reserves checkbox column
 *   menuStyle:         "RightClick" | "EllipsisButton1" | "EllipsisButton2" | "None",
 *   styleClass:        string,     // extra CSS class on container
 *   theme:             "minimal" | "explorer" | "border"
 * }
 *
 * ── Command schema ─────────────────────────────────────────────────
 * {
 *   name:      string,   // unique — returned in onCommand event
 *   label:     string,   // menu item text
 *   nodeType:  string,   // "" = all types, otherwise filter by nodeType
 *   icon:      string,   // CSS class or image URL
 *   iconHover: string,   // alternative icon on hover (optional)
 *   show:      boolean   // false = never show
 * }
 *
 * ── Events (DOM CustomEvents on container) ─────────────────────────
 *   treezle:onNodeClick      → { node }
 *   treezle:onNodeSelect     → { node, selectedIds[] }
 *   treezle:onNodeExpand     → { node }
 *   treezle:onNodeCollapse   → { node }
 *   treezle:beforeNodeExpand → { node, preventDefault() }
 *   treezle:beforeNodeCollapse → { node, preventDefault() }
 *   treezle:onNodeRename     → { node, oldLabel}
 *   treezle:onStartDrag      → { node }
 *   treezle:onNodeMoved      → { node, fromParentId, toParentId, nodes[] }
 *   treezle:onDropNode       → { draggedNode, targetNode, nodes[] }
 *   treezle:onDropRejected   → { reason, draggedNode, targetNode }
 *   treezle:onCommand        → { node, commandName }
 *   treezle:onCheckChanged   → { node, isChecked }
 *   treezle:onNodeAdded      → { node, parentId }
 *   treezle:onNodeDeleted    → { node, nodes[] }
 *   treezle:onNodeChanged    → { node }
 */

(function (global) {
  "use strict";

  // ─── Defaults ────────────────────────────────────────────────────────────────

  const DEFAULT_OPTIONS = {
    multiSelect:       false,
    allowInlineRename: false,
    indentPx:          20,
    showIcons:         false,
    showCheckBoxes:    false,
    menuStyle:         "None",   // "None" | "RightClick" | "EllipsisButton1" | "EllipsisButton2"
    styleClass:        "",
    theme:             "minimal",
  };

  // ─── Helpers ──────────────────────────────────────────────────────────────────

  function uid() {
    return "_tv_" + Math.random().toString(36).slice(2, 9);
  }

  function toStr(val) {
    if (val === null || val === undefined || val === "") return null;
    return String(val);
  }

  function toArray(input) {
    if (!input) return [];
    if (typeof input === "string") {
      try { input = JSON.parse(input); } catch (e) { console.error("Treezle: invalid JSON", e); return []; }
    }
    if (Array.isArray(input)) return input;
    if (typeof input === "object") {
      return Array.from(Object.values(input)).filter(
        (v) => typeof v === "object" && v !== null && !Array.isArray(v)
      );
    }
    return [];
  }

  function normalizeNode(node) {
    const n = Object.assign(
      {
        id:           uid(),
        parentId:     null,
        label:        "Node",
        nodeType:     "",
        isReadOnly:   false,
        isDraggable:  false,
        isExpanded:   false,
        isSelected:   false,
        isDisabled:   false,
        isVisible:    true,
        isChecked:    false,
        showCheckBox: false,
        cssClass:     "",
        icon:         "",
        isDropTarget: false,
        data:         {},
      },
      node
    );
    n.id       = n.id != null ? String(n.id) : uid();
    n.parentId = toStr(n.parentId);
    n._children = [];
    delete n.subNodes;
    return n;
  }

  function flatToNested(nodes) {
    const map   = {};
    const roots = [];
    const arr   = toArray(nodes).map(normalizeNode);
    arr.forEach((n) => (map[n.id] = n));
    arr.forEach((n) => {
      if (n.parentId && map[n.parentId]) map[n.parentId]._children.push(n);
      else roots.push(n);
    });
    
    // Sort children alphabetically by label
    Object.values(map).forEach((n) => n._children.sort((a, b) => a.label.localeCompare(b.label)));
    roots.sort((a, b) => a.label.localeCompare(b.label));
    
    return roots;
  }

  function nestedToFlat(nodes, parentId = null, acc = []) {
    nodes.forEach((n) => {
      const children = n._children || [];
      acc.push({
        id:           n.id,
        parentId:     parentId,
        label:        n.label,
        nodeType:     n.nodeType,
        isReadOnly:   n.isReadOnly,
        isDraggable:  n.isDraggable,
        isExpanded:   n.isExpanded,
        isSelected:   n.isSelected,
        isDisabled:   n.isDisabled,
        isVisible:    n.isVisible,
        isChecked:    n.isChecked,
        showCheckBox: n.showCheckBox,
        cssClass:     n.cssClass,
        icon:         n.icon,
        isDropTarget: !!n.isDropTarget,
        data:         n.data,
      });
      if (children.length) nestedToFlat(children, n.id, acc);
    });
    return acc;
  }

  function cloneNode(node) {
    return {
      id:           node.id,
      parentId:     node.parentId,
      label:        node.label,
      nodeType:     node.nodeType,
      isReadOnly:   node.isReadOnly,
      isDraggable:  node.isDraggable,
      isExpanded:   node.isExpanded,
      isSelected:   node.isSelected,
      isDisabled:   node.isDisabled,
      isVisible:    node.isVisible,
      isChecked:    node.isChecked,
      showCheckBox: node.showCheckBox,
      cssClass:     node.cssClass,
      icon:         node.icon,
      isDropTarget: !!node.isDropTarget,
      data:         JSON.parse(JSON.stringify(node.data || {})),
      isLeaf:       !node._children || node._children.length === 0,
    };
  }

  // ─── SVG helpers ─────────────────────────────────────────────────────────────

  const SVG_ARROW_RIGHT = '<svg viewBox="0 0 10 10" width="10" height="10"><path d="M3 1 L7 5 L3 9" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const SVG_ARROW_DOWN  = '<svg viewBox="0 0 10 10" width="10" height="10"><path d="M1 3 L5 7 L9 3" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function menuStyleClass(menuStyle) {
    const map = {
      'RightClick':      'tv-menu-rightclick',
      'EllipsisButton1': 'tv-menu-ellipsis1',
      'EllipsisButton2': 'tv-menu-ellipsis2',
    };
    return map[menuStyle] || '';
  }

  // ─── TreeView Class ──────────────────────────────────────────────────────────

  class TreeView {

    constructor(container, nodes = [], options = {}, commands = []) {
      this._el = typeof container === "string"
        ? document.querySelector(container)
        : container;
      if (!this._el) throw new Error("Treezle: container not found");

      this._opts        = Object.assign({}, DEFAULT_OPTIONS, typeof options  === "string" ? JSON.parse(options)  : options);
      this._commands    = toArray(commands);
      this._tree        = flatToNested(typeof nodes === "string" ? JSON.parse(nodes) : nodes);
      this._events      = {};
      this._dragState   = null;
      this._selectedIds = {};
      this._activeMenu  = null;

      // Apply classes
      this._el.classList.add("tv-container", "tv-theme-" + this._opts.theme);
      if (this._opts.styleClass) this._el.classList.add(this._opts.styleClass);
      if (this._opts.menuStyle !== "None") this._el.classList.add(menuStyleClass(this._opts.menuStyle));

      this._render();
      this._bindGlobal();
    }

    // ── Public API ──────────────────────────────────────────────────────────────

    setNodes(nodes) {
      this._tree = flatToNested(nodes || []);
      this._selectedIds = {};
      this._render();
    }

    setCommands(commands) {
      this._commands = toArray(commands);
    }

    setOptions(options) {
      const prev = this._opts;
      this._opts = Object.assign({}, prev, typeof options === "string" ? JSON.parse(options) : options);
      // Reapply container classes if theme or styleClass changed
      this._el.className = "";
      this._el.classList.add("tv-container", "tv-theme-" + this._opts.theme);
      if (this._opts.menuStyle !== "None") this._el.classList.add(menuStyleClass(this._opts.menuStyle));
      if (this._opts.styleClass) this._el.classList.add(this._opts.styleClass);
      this._render();
    }

    getNodes() { return nestedToFlat(this._tree); }

    getChangedNodes() {
      const dirty = [];
      const walk  = (nodes) => nodes.forEach((n) => {
        if (n._dirty) dirty.push(cloneNode(n));
        if (n._children) walk(n._children);
      });
      walk(this._tree);
      return dirty;
    }

    expand(id)     { const n = this._findNode(String(id), this._tree); if (n) { n.isExpanded = true;  this._render(); } }
    collapse(id)   { const n = this._findNode(String(id), this._tree); if (n) { n.isExpanded = false; this._render(); } }
    selectNode(id) { this._selectNodeById(String(id)); }

    /**
     * toggleSelect(id)
     * Toggles the selection state of a node.
     * - multiSelect ON:  adds/removes the node from the current selection,
     *                    leaving other selected nodes untouched.
     * - multiSelect OFF: selects the node if not selected, deselects all if it was.
     * Fires treezle:onNodeSelect u2192 { node, selectedIds[] }
     */
    toggleSelect(id) {
      const node = this._findNode(String(id), this._tree);
      if (!node || node.isDisabled) return;

      if (this._opts.multiSelect) {
        node.isSelected = !node.isSelected;
        if (node.isSelected) this._selectedIds[node.id] = true;
        else delete this._selectedIds[node.id];
      } else {
        const wasSelected = node.isSelected;
        this._clearSelection(this._tree);
        if (!wasSelected) {
          node.isSelected = true;
          this._selectedIds[node.id] = true;
        }
      }

      this._render();
      this._emit("onNodeSelect", { node: cloneNode(node), selectedIds: Object.keys(this._selectedIds) });
    }

    /**
     * addNode(containerId, nodeJSON)
     * Adds a new node under containerId. Pass null/empty for root level.
     * nodeJSON can be a JSON string or plain object — missing fields get defaults.
     * The parent is automatically expanded so the new node is visible.
     * Fires treezle:onNodeAdded → { node, parentId }
     */
    addNode(containerId, nodeJSON) {
      let raw;
      try {
        raw = typeof nodeJSON === "string" ? JSON.parse(nodeJSON) : nodeJSON;
      } catch (e) {
        console.error("Treezle.addNode: invalid nodeJSON", e);
        return null;
      }

      const newNode = normalizeNode(raw);

      if (containerId) {
        const parentId  = String(containerId);
        const container = this._findNode(parentId, this._tree);
        if (!container) {
          console.warn("Treezle.addNode: container not found:", parentId);
          return null;
        }
        newNode.parentId     = parentId;
        container._children  = container._children || [];
        container._children.push(newNode);
        container.isExpanded = true;
        container._dirty     = true;
      } else {
        newNode.parentId = null;
        this._tree.push(newNode);
      }

      this._render();
      this._emit("onNodeAdded", { node: cloneNode(newNode), parentId: newNode.parentId });
      return cloneNode(newNode);
    }

    /**
     * deleteNode(id)
     * Removes a node and all its descendants from the tree.
     * Fires treezle:onNodeDeleted → { node, nodes[] }
     * nodes[] is the full updated flat array — ready to sync back to the server.
     */
    deleteNode(id) {
      const nodeId = String(id);

      // Collect all ids to remove (node + all descendants)
      const toRemove = new Set();
      const collectIds = (nodes) => {
        nodes.forEach((n) => {
          if (toRemove.has(n.id) || n.id === nodeId) {
            toRemove.add(n.id);
            if (n._children) collectIds(n._children);
          } else if (n._children) {
            collectIds(n._children);
          }
        });
      };

      // Find the node before removing (for the event payload)
      const target = this._findNode(nodeId, this._tree);
      if (!target) {
        console.warn("Treezle.deleteNode: node not found:", nodeId);
        return null;
      }
      const deleted = cloneNode(target);
      toRemove.add(nodeId);
      if (target._children) collectIds(target._children);

      // Remove from tree recursively
      const removeFrom = (nodes) => {
        for (let i = nodes.length - 1; i >= 0; i--) {
          if (toRemove.has(nodes[i].id)) {
            nodes.splice(i, 1);
          } else if (nodes[i]._children) {
            removeFrom(nodes[i]._children);
          }
        }
      };
      removeFrom(this._tree);

      // Clear selection if deleted node was selected
      if (this._selectedIds[nodeId]) delete this._selectedIds[nodeId];

      this._render();
      const updatedNodes = nestedToFlat(this._tree);
      this._emit("onNodeDeleted", { node: deleted, nodes: updatedNodes });
      return deleted;
    }

    /**
     * editNode(nodeData)
     * Merges nodeData into the existing node with the same id.
     * Only the fields present in nodeData are updated — others are left untouched.
     * nodeData must contain at least { id }.
     * nodeData can be a JSON string or plain object.
     * Fires treezle:onNodeChanged → { node }
     */
    editNode(nodeData) {
      let raw;
      try {
        raw = typeof nodeData === "string" ? JSON.parse(nodeData) : nodeData;
      } catch (e) {
        console.error("Treezle.editNode: invalid nodeData", e);
        return null;
      }

      if (!raw.id) {
        console.warn("Treezle.editNode: nodeData must contain an id");
        return null;
      }

      const node = this._findNode(String(raw.id), this._tree);
      if (!node) {
        console.warn("Treezle.editNode: node not found:", raw.id);
        return null;
      }

      // Merge — skip internal fields (_children, _dirty etc.)
      const INTERNAL = new Set(["_children", "_dirty", "_loaded"]);
      Object.keys(raw).forEach((key) => {
        if (!INTERNAL.has(key)) {
          node[key] = raw[key];
        }
      });
      node._dirty = true;

      this._render();
      this._emit("onNodeChanged", { node: cloneNode(node) });
      return cloneNode(node);
    }

    on(event, handler) {
      if (!this._events[event]) this._events[event] = [];
      this._events[event].push(handler);
      return this;
    }

    off(event, handler) {
      if (this._events[event])
        this._events[event] = this._events[event].filter((h) => h !== handler);
      return this;
    }

    destroy() {
      this._closeMenu();
      this._el.innerHTML = "";
      this._el.classList.remove("tv-container", "tv-theme-" + this._opts.theme);
      document.removeEventListener("click",   this._onDocClick);
      document.removeEventListener("dragover", this._onDocDragOver);
      document.removeEventListener("drop",    this._onDocDrop);
    }

    // ── Event Emission ──────────────────────────────────────────────────────────

    _emit(event, payload) {
      if (this._events[event])
        this._events[event].forEach((h) => h(payload));
      this._el.dispatchEvent(new CustomEvent("treezle:" + event, {
        bubbles: true,
        detail:  payload,
      }));
    }

    // ── Rendering ───────────────────────────────────────────────────────────────

    _render() {
      if (this._renaming) return; // don't blow away an active rename input
      this._el.innerHTML = "";
      const ul = document.createElement("ul");
      ul.className = "tv-list tv-root";
      this._tree
        .filter((n) => n.isVisible !== false)
        .forEach((n) => this._renderNode(n, ul, 0));
      this._el.appendChild(ul);
    }

    _renderNode(node, parentEl, depth) {
      const li = document.createElement("li");
      li.className  = "tv-node";
      li.dataset.id = node.id;
      li.dataset.type = node.nodeType;
      li.dataset.depth = depth;

      const row = document.createElement("div");
      row.className = [
        "tv-row",
        node.isSelected ? "tv-selected" : "",
        node.isDisabled ? "tv-disabled" : "",
        node.cssClass   || "",
      ].filter(Boolean).join(" ");
      row.style.paddingLeft = (depth * this._opts.indentPx) + "px";

      // ── Arrow
      const arrow = document.createElement("span");
      arrow.className = "tv-arrow";
      if (node._children && node._children.length) {
        arrow.innerHTML = node.isExpanded ? SVG_ARROW_DOWN : SVG_ARROW_RIGHT;
        arrow.addEventListener("click", (e) => { e.stopPropagation(); this._toggleExpand(node); });
      } else {
        arrow.classList.add("tv-arrow-leaf");
      }
      row.appendChild(arrow);

      // ── Checkbox column
      if (this._opts.showCheckBoxes) {
        if (node.showCheckBox) {
          const wrap = document.createElement("span");
          wrap.className = "tv-checkbox-wrap";
          const cb = document.createElement("input");
          cb.type      = "checkbox";
          cb.className = "tv-checkbox";
          cb.checked   = !!node.isChecked;
          cb.addEventListener("click",    (e) => e.stopPropagation());
          cb.addEventListener("mousedown", (e) => e.stopPropagation());
          cb.addEventListener("change", (e) => {
            e.stopPropagation();
            node.isChecked = cb.checked;
            node._dirty    = true;
            this._emit("onCheckChanged", { node: cloneNode(node), isChecked: node.isChecked });
          });
          wrap.appendChild(cb);
          row.appendChild(wrap);
        } else {
          // Reserve space so labels stay aligned
          const spacer = document.createElement("span");
          spacer.className = "tv-checkbox-spacer";
          row.appendChild(spacer);
        }
      }

      // ── Icon
      if (this._opts.showIcons) {
        const iconEl = document.createElement("span");
        iconEl.className = "tv-icon";
        if (node.icon) {
          if (node.icon.indexOf("http") === 0 || node.icon.indexOf("/") === 0) {
            const img = document.createElement("img");
            img.src = node.icon; img.className = "tv-icon-img";
            iconEl.appendChild(img);
          } else {
            const iEl = document.createElement("i");
            iEl.className = node.icon;
            iconEl.appendChild(iEl);
          }
        }
        row.appendChild(iconEl);
      }

      // ── Label
      const label = document.createElement("span");
      label.className   = "tv-label";
      label.textContent = node.label;
      if (!node.isReadOnly && this._opts.allowInlineRename) {
        label.addEventListener("dblclick", (e) => { e.stopPropagation(); this._startRename(node, label); });
      }
      row.appendChild(label);

      // ── Ellipsis button (EllipsisButton1 = horizontal ⋯, EllipsisButton2 = vertical ⋮)
      const menuStyle = this._opts.menuStyle;
      const hasCommands = this._commandsForNode(node).length > 0;

      if (hasCommands && (menuStyle === "EllipsisButton1" || menuStyle === "EllipsisButton2")) {
        const btn = document.createElement("button");
        btn.className = "tv-ellipsis " + (menuStyle === "EllipsisButton1" ? "tv-ellipsis-h" : "tv-ellipsis-v");
        btn.title     = "Opties";
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          this._openMenu(node, btn);
        });
        row.appendChild(btn);
      }

      // ── Row events
      row.addEventListener("click", (e) => { if (!node.isDisabled) this._handleClick(e, node); });

      if (hasCommands && menuStyle === "RightClick") {
        row.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          e.stopPropagation();
          this._openMenuAtCursor(node, e.clientX, e.clientY);
        });
      }

      // ── Drag source
      if (node.isDraggable) {
        row.setAttribute("draggable", "true");
        row.addEventListener("dragstart", (e) => this._onDragStart(e, node));
        row.addEventListener("dragend",   () => this._onDragEnd());
      }

      // ── Drop target
      row.addEventListener("dragover",  (e) => this._onDragOver(e, node, row));
      row.addEventListener("dragleave", ()  => this._onDragLeave(row));
      row.addEventListener("drop",      (e) => this._onDrop(e, node));

      li.appendChild(row);

      // ── Children
      if (node._children && node._children.length && node.isExpanded) {
        const childUl = document.createElement("ul");
        childUl.className = "tv-list";
        node._children
          .filter((n) => n.isVisible !== false)
          .forEach((child) => this._renderNode(child, childUl, depth + 1));
        li.appendChild(childUl);
      }

      parentEl.appendChild(li);
    }

    // ── Context Menu ─────────────────────────────────────────────────────────────

    _commandsForNode(node) {
      return this._commands.filter((c) => {
        if (c.show === false) return false;
        if (!c.nodeType || c.nodeType === "") return true;
        return c.nodeType === node.nodeType;
      });
    }

    _openMenu(node, anchorEl) {
      this._closeMenu();
      const cmds = this._commandsForNode(node);
      if (!cmds.length) return;

      const menu = this._buildMenu(node, cmds);
      document.body.appendChild(menu);
      this._activeMenu = menu;

      // Position: below the anchor button
      const rect = anchorEl.getBoundingClientRect();
      this._positionMenu(menu, rect.left, rect.bottom + 2);
    }

    _openMenuAtCursor(node, x, y) {
      this._closeMenu();
      const cmds = this._commandsForNode(node);
      if (!cmds.length) return;

      const menu = this._buildMenu(node, cmds);
      document.body.appendChild(menu);
      this._activeMenu = menu;
      this._positionMenu(menu, x, y);
    }

    _buildMenu(node, cmds) {
      const menu = document.createElement("div");
      menu.className = "tv-menu";

      cmds.forEach((cmd) => {
        const item = document.createElement("div");
        item.className = "tv-menu-item";

        if (cmd.icon) {
          const iconEl = document.createElement("span");
          iconEl.className = "tv-menu-item-icon";
          if (cmd.icon.indexOf("http") === 0 || cmd.icon.indexOf("/") === 0) {
            const img = document.createElement("img");
            img.src = cmd.icon; img.style.width = "100%";
            iconEl.appendChild(img);
          } else {
            const iEl = document.createElement("i");
            iEl.className = cmd.icon;
            iconEl.appendChild(iEl);
          }
          item.appendChild(iconEl);
        }

        const lbl = document.createElement("span");
        lbl.className   = "tv-menu-item-label";
        lbl.textContent = cmd.label || cmd.name;
        item.appendChild(lbl);

        item.addEventListener("mouseenter", () => {
          if (cmd.iconHover) {
            const iconEl = item.querySelector(".tv-menu-item-icon i, .tv-menu-item-icon img");
            if (iconEl) iconEl.className = cmd.iconHover;
          }
        });
        item.addEventListener("mouseleave", () => {
          if (cmd.icon && cmd.iconHover) {
            const iconEl = item.querySelector(".tv-menu-item-icon i, .tv-menu-item-icon img");
            if (iconEl) iconEl.className = cmd.icon;
          }
        });

        item.addEventListener("click", (e) => {
          e.stopPropagation();
          this._closeMenu();
          this._emit("onCommand", { node: cloneNode(node), commandName: cmd.name });
        });

        menu.appendChild(item);
      });

      return menu;
    }

    _positionMenu(menu, x, y) {
      // Temporarily visible off-screen to measure
      menu.style.visibility = "hidden";
      menu.style.left = "0px";
      menu.style.top  = "0px";

      requestAnimationFrame(() => {
        const mw = menu.offsetWidth;
        const mh = menu.offsetHeight;
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        let left = x;
        let top  = y;
        if (left + mw > vw) left = vw - mw - 8;
        if (top  + mh > vh) top  = y - mh - 4;
        if (left < 4) left = 4;
        if (top  < 4) top  = 4;

        menu.style.left       = left + "px";
        menu.style.top        = top  + "px";
        menu.style.visibility = "visible";
      });
    }

    _closeMenu() {
      if (this._activeMenu) {
        this._activeMenu.remove();
        this._activeMenu = null;
      }
    }

    // ── Interactions ────────────────────────────────────────────────────────────

    _handleClick(e, node) {
      this._closeMenu();
      if (this._opts.multiSelect && e.ctrlKey) {
        node.isSelected = !node.isSelected;
        if (node.isSelected) this._selectedIds[node.id] = true;
        else delete this._selectedIds[node.id];
      } else {
        this._clearSelection(this._tree);
        node.isSelected = true;
        this._selectedIds = { [node.id]: true };
      }
      this._render();
      this._emit("onNodeClick",  { node: cloneNode(node) });
      this._emit("onNodeSelect", { node: cloneNode(node), selectedIds: Object.keys(this._selectedIds) });
    }

    _toggleExpand(node) {
      let cancelled = false;
      const evName  = node.isExpanded ? "beforeNodeCollapse" : "beforeNodeExpand";
      this._emit(evName, { node: cloneNode(node), preventDefault: () => { cancelled = true; } });
      if (cancelled) return;
      node.isExpanded = !node.isExpanded;
      node._dirty     = true;
      this._render();
      this._emit(node.isExpanded ? "onNodeExpand" : "onNodeCollapse", { node: cloneNode(node) });
    }

    _clearSelection(nodes) {
      nodes.forEach((n) => {
        n.isSelected = false;
        if (n._children) this._clearSelection(n._children);
      });
      this._selectedIds = {};
    }

    _selectNodeById(id) {
      this._clearSelection(this._tree);
      const node = this._findNode(id, this._tree);
      if (node) {
        node.isSelected = true;
        this._selectedIds[id] = true;
        this._render();
      }
    }

    // ── Inline Rename ───────────────────────────────────────────────────────────

    _startRename(node, labelEl) {
      this._renaming = true;
      const oldLabel = node.label;
      const input    = document.createElement("input");
      input.className = "tv-rename-input";
      input.value     = oldLabel;
      labelEl.parentNode.replaceChild(input, labelEl);
      input.focus();
      input.select();

      // Prevent clicks on the input from triggering row click / re-render
      input.addEventListener("click",    (e) => e.stopPropagation());
      input.addEventListener("mousedown", (e) => e.stopPropagation());

      const done = (save) => {
        if (!this._renaming) return; // guard against double-fire (blur + enter)
        this._renaming = false;
        if (save) {
          const newLabel = input.value.trim() || oldLabel;
          if (newLabel !== oldLabel) {
            node.label  = newLabel;
            node._dirty = true;
            this._emit("onNodeRename", { node: cloneNode(node), oldLabel});
          }
        }
        this._render();
      };

      input.addEventListener("blur",    () => done(true));
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter")  { e.preventDefault(); done(true);  }
        if (e.key === "Escape") { e.preventDefault(); done(false); }
      });
    }

    // ── Drag & Drop ─────────────────────────────────────────────────────────────

    _onDragStart(e, node) {
      this._dragState = { node, sourceParentId: node.parentId };
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", node.id);
      e.currentTarget.classList.add("tv-dragging");
      this._emit("onStartDrag", { node: cloneNode(node) });
    }

    _onDragEnd() {
      document.querySelectorAll(".tv-dragging, .tv-drop-over").forEach((el) => {
        el.classList.remove("tv-dragging", "tv-drop-over");
      });
    }

    _onDragOver(e, targetNode, rowEl) {
      if (!this._dragState || this._dragState.node.id === targetNode.id) return;
      e.preventDefault();
      document.querySelectorAll(".tv-drop-over, .tv-no-drop").forEach((el) => el.classList.remove("tv-drop-over", "tv-no-drop"));
      if (targetNode.isDropTarget === false) {
        e.dataTransfer.dropEffect = "none";
        rowEl.classList.add("tv-no-drop");
      } else {
        e.dataTransfer.dropEffect = "move";
        rowEl.classList.add("tv-drop-over");
      }
    }

    _onDragLeave(rowEl) { rowEl.classList.remove("tv-drop-over"); }

    _onDrop(e, targetNode) {
      e.preventDefault();
      document.querySelectorAll(".tv-drop-over").forEach((el) => el.classList.remove("tv-drop-over"));
      if (!this._dragState) return;

      const { node: draggedNode, sourceParentId } = this._dragState;
      if (draggedNode.id === targetNode.id) return;

      if (targetNode.isDropTarget === false) {
        this._emit("onDropRejected", { reason: "notDropTarget", draggedNode: cloneNode(draggedNode), targetNode: cloneNode(targetNode) });
        return;
      }

      if (this._isDescendant(draggedNode.id, targetNode.id, this._tree)) {
        this._emit("onDropRejected", { reason: "circular", draggedNode: cloneNode(draggedNode), targetNode: cloneNode(targetNode) });
        return;
      }

      this._removeFromTree(draggedNode.id, this._tree);
      draggedNode.parentId  = targetNode.id;
      draggedNode._dirty    = true;
      targetNode._children  = targetNode._children || [];
      targetNode._children.push(draggedNode);
      targetNode.isExpanded = true;
      targetNode._dirty     = true;

      this._render();
      this._emit("onDropNode",  { draggedNode: cloneNode(draggedNode), targetNode: cloneNode(targetNode) });
      this._emit("onNodeMoved", { node: cloneNode(draggedNode), fromParentId: sourceParentId, toParentId: targetNode.id });
      this._dragState = null;
    }

    // ── Global bindings ─────────────────────────────────────────────────────────

    _bindGlobal() {
      this._onDocClick    = (e) => { if (this._activeMenu && !this._activeMenu.contains(e.target)) this._closeMenu(); };
      this._onDocDragOver = (e) => e.preventDefault();
      this._onDocDrop     = () => (this._dragState = null);
      document.addEventListener("click",   this._onDocClick);
      document.addEventListener("dragover", this._onDocDragOver);
      document.addEventListener("drop",    this._onDocDrop);
    }

    // ── Tree Utils ──────────────────────────────────────────────────────────────

    _findNode(id, nodes) {
      for (const n of nodes) {
        if (n.id === id) return n;
        if (n._children) { const f = this._findNode(id, n._children); if (f) return f; }
      }
      return null;
    }

    _removeFromTree(id, nodes) {
      for (let i = 0; i < nodes.length; i++) {
        if (nodes[i].id === id) { nodes.splice(i, 1); return true; }
        if (nodes[i]._children && this._removeFromTree(id, nodes[i]._children)) return true;
      }
      return false;
    }

    _isDescendant(ancestorId, nodeId, nodes) {
      const ancestor = this._findNode(ancestorId, nodes);
      if (!ancestor) return false;
      return this._findNode(nodeId, ancestor._children || []) !== null;
    }
  }

  // ─── Instance Registry ────────────────────────────────────────────────────────
  // Allows multiple TreeView instances on the same page to be retrieved by the
  // HTML id of their container element.
  // Usage:  TreeView.getInstance("myTreeId")  → TreeView instance or null

  TreeView._registry = {};

  TreeView.getInstance = function (treeId) {
    const key = String(treeId);

    // 1. Direct hit — container element itself has this id
    if (TreeView._registry[key]) return TreeView._registry[key];

    // 2. Indirect hit — treeId is a wrapper element (e.g. OutSystems WebBlock div)
    //    that contains the actual .tv-container. Walk its descendants to find it.
    const wrapper = document.getElementById(key);
    if (wrapper) {
      // Try inner container id first (fast path)
      const inner = wrapper.querySelector(".tv-container");
      if (inner && inner.id && TreeView._registry[inner.id]) return TreeView._registry[inner.id];
      // No id on inner container — scan registry by element reference
      for (const inst of Object.values(TreeView._registry)) {
        if (wrapper.contains(inst._el)) return inst;
      }
    }

    return null;
  };

  // Auto-register on construction; auto-unregister on destroy.
  const _originalConstructor = TreeView;

  const _origDestroy = TreeView.prototype.destroy;
  TreeView.prototype.destroy = function () {
    if (this._el && this._el.id) delete TreeView._registry[this._el.id];
    _origDestroy.call(this);
  };

  // Hook into the constructor via the class itself — patch _bindGlobal (called
  // last in constructor) so registration happens after full init.
  const _origBindGlobal = TreeView.prototype._bindGlobal;
  TreeView.prototype._bindGlobal = function () {
    _origBindGlobal.call(this);
    if (this._el && this._el.id) TreeView._registry[this._el.id] = this;
  };

  // ─── Export ───────────────────────────────────────────────────────────────────

  global.TreeView = TreeView;

})(typeof window !== "undefined" ? window : global);
