import {
  collection,
  addDoc,
  onSnapshot,
  doc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  getDoc,
  getDocFromCache,
  getDocs,
  writeBatch,
  runTransaction
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";

import { db, auth, offlineReady } from "./firebase.js";

document.addEventListener("DOMContentLoaded", async () => {
  const $ = (id) => document.getElementById(id);

  // ==================================================
  // LOCAL OFFLINE SALES QUEUE
  // Only successfully synchronized sales are removed.
  // ==================================================

  const QUEUE_KEY = "olivePOS_pendingSales_v1";

  function readQueue() {
    try {
      const data = JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]");
      return Array.isArray(data) ? data : [];
    } catch (error) {
      console.error("Could not read offline sales queue:", error);
      return [];
    }
  }

  function saveQueue(queue) {
    try {
      localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
      updatePendingIndicator();
      return true;
    } catch (error) {
      console.error("Could not save offline sales:", error);

      showMessage(
        "Unable to store the sale locally. Check available phone storage and browser settings."
      );

      return false;
    }
  }

  let pendingSales = readQueue();
  let syncingSales = false;

  // ==================================================
  // GENERAL HELPERS
  // ==================================================

  function showMessage(message) {
    let notice = $("appNotice");

    if (!notice) {
      notice = document.createElement("p");
      notice.id = "appNotice";
      notice.setAttribute("role", "status");
      notice.setAttribute("aria-live", "polite");

      const header = document.querySelector(".topbar");

      if (header) {
        header.insertAdjacentElement("afterend", notice);
      } else {
        document.body.prepend(notice);
      }
    }

    notice.textContent = message;
  }

  
function showSaleSavedModal({ synced = false, count = 1 } = {}) {
  let modal = document.getElementById("saleSavedModal");

  if (!modal) {
    modal = document.createElement("div");
    modal.id = "saleSavedModal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", "saleSavedTitle");

    Object.assign(modal.style, {
      position: "fixed",
      inset: "0",
      zIndex: "99999",
      background: "rgba(0,0,0,0.65)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "20px"
    });

    const panel = document.createElement("div");

    Object.assign(panel.style, {
      background: "#F5EBDD",
      color: "#11213a",
      width: "100%",
      maxWidth: "360px",
      padding: "28px 22px",
      borderRadius: "18px",
      textAlign: "center",
      boxShadow: "0 12px 40px rgba(0,0,0,0.25)"
    });

    const icon = document.createElement("div");
    icon.textContent = "✓";
    Object.assign(icon.style, {
      fontSize: "42px",
      fontWeight: "bold",
      color: "#647548",
      marginBottom: "10px"
    });

    const title = document.createElement("h2");
    title.id = "saleSavedTitle";
    title.style.margin = "0 0 12px";

    const message = document.createElement("p");
    message.id = "saleSavedMessage";
    Object.assign(message.style, {
      lineHeight: "1.6",
      overflowWrap: "anywhere"
    });

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.textContent = "Continue";
    Object.assign(closeButton.style, {
      background: "#647548",
      color: "#ffffff",
      border: "none",
      borderRadius: "10px",
      padding: "13px 24px",
      width: "100%",
      fontSize: "16px",
      fontWeight: "bold",
      cursor: "pointer",
      marginTop: "12px"
    });

    closeButton.addEventListener("click", () => {
      modal.remove();
    });

    panel.append(icon, title, message, closeButton);
    modal.append(panel);
    document.body.append(modal);

    modal.addEventListener("click", (event) => {
      if (event.target === modal) modal.remove();
    });
  }

  const title = document.getElementById("saleSavedTitle");
  const message = document.getElementById("saleSavedMessage");

  if (synced) {
    title.textContent = "Order Saved Successfully!";
    message.textContent =
      "Your sale has been confirmed by Firebase. " +
      "It is now saved in your shared sales history.";
  } else {
    title.textContent = "Order Saved on This Device!";
    message.textContent =
      `${count} sale(s) are safely queued on this device. ` +
      "They will automatically sync when your internet connection returns. " +
      "Keep this browser's site data safe until syncing finishes.";
  }

  modal.style.display = "flex";
  modal.querySelector("button")?.focus();
}


  function formatMoney(value) {
    return new Intl.NumberFormat("en-PH", {
      style: "currency",
      currency: "PHP"
    }).format(Number(value) || 0);
  }

  function makeElement(tag, className = "", text = "") {
    const element = document.createElement(tag);

    if (className) element.className = className;

    element.textContent = text;

    return element;
  }

  function makeButton(text, className, onClick) {
    const button = makeElement("button", className, text);
    button.type = "button";
    button.addEventListener("click", onClick);
    return button;
  }

  function showEmpty(container, message) {
    if (container) {
      container.append(makeElement("p", "empty", message));
    }
  }

  function waitForUser() {
    return new Promise((resolve) => {
      const unsubscribe = onAuthStateChanged(auth, (user) => {
        unsubscribe();
        resolve(user);
      });
    });
  }

  function makeSaleId() {
    if (globalThis.crypto?.randomUUID) {
      return globalThis.crypto.randomUUID();
    }

    return (
      "sale_" +
      Date.now() +
      "_" +
      Math.random().toString(36).slice(2, 12)
    );
  }

  function updatePendingIndicator() {
    const count = pendingSales.length;

    let indicator = $("pendingSyncStatus");

    if (!indicator) {
      indicator = makeElement("p");
      indicator.id = "pendingSyncStatus";
      indicator.setAttribute("role", "status");
      indicator.setAttribute("aria-live", "polite");

      const header = document.querySelector(".topbar");

      if (header) {
        header.insertAdjacentElement("afterend", indicator);
      } else {
        document.body.prepend(indicator);
      }
    }

    if (!navigator.onLine) {
      indicator.textContent =
        `OFFLINE — ${count} sale(s) waiting to sync`;
      indicator.className = "offline";
    } else if (count > 0) {
      indicator.textContent =
        `SYNC PENDING — ${count} sale(s) waiting to upload`;
      indicator.className = "sync-pending";
    } else if (syncingSales) {
      indicator.textContent = "SYNCING SALES...";
      indicator.className = "syncing";
    } else {
      indicator.textContent = "ONLINE — no pending sales";
      indicator.className = "synced";
    }
  }

  // ==================================================
  // AUTHENTICATION AND STAFF VERIFICATION
  // ==================================================

  const logoutButton = $("logoutButton");

  logoutButton?.addEventListener("click", async () => {
    if (!confirm("Are you sure you want to log out?")) return;

    if (pendingSales.length > 0) {
      const proceed = confirm(
        `${pendingSales.length} sale(s) have not synced. ` +
        "They will remain on this device, but keep this device's " +
        "browser data safe until synchronization finishes. Log out?"
      );

      if (!proceed) return;
    }

    logoutButton.disabled = true;

    try {
      await signOut(auth);
      window.location.replace("./login.html");
    } catch (error) {
      console.error("Logout failed:", error);
      showMessage("Unable to log out. Please try again.");
      logoutButton.disabled = false;
    }
  });

  let currentUser;

  try {
    await offlineReady;

    currentUser = await waitForUser();

    if (!currentUser) {
      window.location.replace("./login.html");
      return;
    }

    let staffSnapshot;

    try {
      staffSnapshot = await getDoc(
        doc(db, "staff", currentUser.uid)
      );
    } catch (error) {
      if (!navigator.onLine) {
        staffSnapshot = await getDocFromCache(
          doc(db, "staff", currentUser.uid)
        );
      } else {
        throw error;
      }
    }

    if (
      !staffSnapshot.exists() ||
      staffSnapshot.data().approved !== true
    ) {
      if (navigator.onLine) await signOut(auth);

      window.location.replace("./login.html");
      return;
    }
  } catch (error) {
    console.error("Staff verification failed:", error);

    document.body.textContent = navigator.onLine
      ? "Unable to verify staff access. Please reload and try again."
      : "Staff approval could not be verified offline. Open the app online first to cache the approval record.";

    return;
  }

  // ==================================================
  // ELEMENTS AND STATE
  // ==================================================

  const navButtons = document.querySelectorAll(
    ".bottom-nav .nav-button"
  );

  const pages = document.querySelectorAll(".page");

  const productForm = $("productForm");
  const productId = $("productId");
  const productName = $("productName");
  const productPrice = $("productPrice");
  const productStock = $("productStock");
  const productList = $("productList");
  const posProducts = $("posProducts");

  const cartItems = $("cartItems");
  const subtotalElement = $("subtotal");
  const discountInput = $("discount");
  const grandTotalElement = $("grandTotal");
  const cashInput = $("cashReceived");
  const changeElement = $("changeDue");

  const shoppingForm = $("shoppingForm");
  const shoppingList = $("shoppingList");
  const shoppingBudget = $("shoppingBudget");
  const shoppingTotal = $("shoppingTotal");
  const budgetRemaining = $("budgetRemaining");

  const historyList = $("historyList");

  let products = [];
  let cart = [];
  let shoppingItems = [];
  let sales = [];

  let isCheckingOut = false;

  let productSnapshotFromServer = false;
  let salesSnapshotFromServer = false;
  let shoppingSnapshotFromServer = false;

  // ==================================================
  // PAGE NAVIGATION
  // ==================================================

  function openPage(targetId) {
    const targetPage = $(targetId);
    if (!targetPage) return;

    pages.forEach((page) => page.classList.remove("active"));
    navButtons.forEach((button) => button.classList.remove("active"));

    targetPage.classList.add("active");

    document
      .querySelector(`.nav-button[data-page="${targetId}"]`)
      ?.classList.add("active");

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  navButtons.forEach((button) => {
    button.addEventListener("click", () => openPage(button.dataset.page));
  });

  document.querySelectorAll("[data-open]").forEach((button) => {
    button.addEventListener("click", () => openPage(button.dataset.open));
  });

  // ==================================================
  // STOCK RESERVED BY LOCAL PENDING SALES
  // ==================================================

  function pendingQuantity(productIdValue) {
    return pendingSales.reduce((total, sale) => {
      const quantity = (sale.items || [])
        .filter((item) => item.productId === productIdValue)
        .reduce((sum, item) => sum + Number(item.quantity || 0), 0);

      return total + quantity;
    }, 0);
  }

  function availableStock(product) {
    return Math.max(
      0,
      (Number(product.stock) || 0) - pendingQuantity(product.id)
    );
  }

  // ==================================================
  // CONNECTION STATUS
  // ==================================================

  function updateConnectionStatus() {
    const status = $("connectionStatus");

    if (status) {
      status.classList.toggle("offline", !navigator.onLine);

      if (!navigator.onLine) {
        status.textContent = "Offline — local sales queue enabled";
      } else if (pendingSales.length > 0 || syncingSales) {
        status.textContent =
          `Syncing sales — ${pendingSales.length} pending`;
      } else {
        const synced =
          productSnapshotFromServer &&
          salesSnapshotFromServer &&
          shoppingSnapshotFromServer;

        status.textContent = synced
          ? "Online — synced with Firebase"
          : "Online — connecting to Firebase...";
      }
    }

    updatePendingIndicator();
  }

  window.addEventListener("offline", () => {
    updateConnectionStatus();
    showMessage(
      "Internet disconnected. Completed sales can be queued locally."
    );
  });

  window.addEventListener("online", async () => {
    updateConnectionStatus();

    showMessage(
      "Internet restored. Checking pending sales for automatic synchronization..."
    );

    await syncPendingSales();
  });

  // ==================================================
  // PRODUCT MANAGEMENT
  // ==================================================

  function makeProductCard(product, forPOS = false) {
    const card = makeElement("article", "product-card");
    const stock = availableStock(product);

    card.append(
      makeElement("h3", "", product.name || "Unnamed product"),
      makeElement("p", "", formatMoney(product.price)),
      makeElement("p", "muted", `Available stock: ${stock}`)
    );

    if (forPOS) {
      const addButton = makeButton(
        stock > 0 ? "Add to cart" : "Out of stock",
        "button primary full",
        () => addToCart(product.id)
      );

      addButton.disabled = stock <= 0;
      card.append(addButton);

      return card;
    }

    const actions = makeElement("div", "product-actions");

    actions.append(
      makeButton("Edit", "button", () => {
        productId.value = product.id;
        productName.value = product.name;
        productPrice.value = product.price;
        productStock.value = product.stock;

        openPage("productsPage");
        productName.focus();
      }),

      makeButton("Delete", "button", async () => {
        if (!navigator.onLine) {
          showMessage("Connect to the internet before deleting products.");
          return;
        }

        if (!confirm(`Delete "${product.name}"? This cannot be undone.`)) {
          return;
        }

        try {
          await deleteDoc(doc(db, "products", product.id));
          showMessage("Product deleted.");
        } catch (error) {
          console.error(error);
          showMessage("Could not delete product.");
        }
      })
    );

    card.append(actions);
    return card;
  }

  function renderProducts() {
    productList?.replaceChildren();
    posProducts?.replaceChildren();

    if (!products.length) {
      showEmpty(productList, "No products added yet.");
      showEmpty(posProducts, "No products available.");
      return;
    }

    products.forEach((product) => {
      productList?.append(makeProductCard(product));
      posProducts?.append(makeProductCard(product, true));
    });
  }

  productForm?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const name = productName.value.trim();
    const price = Number(productPrice.value);
    const stock = Number(productStock.value);

    if (
      !name ||
      !Number.isFinite(price) ||
      price <= 0 ||
      !Number.isInteger(stock) ||
      stock < 0
    ) {
      showMessage("Enter a name, a positive price, and valid stock.");
      return;
    }

    if (!navigator.onLine) {
      showMessage(
        "Product management is online-only in this version. Reconnect to save product changes."
      );
      return;
    }

    const saveButton = productForm.querySelector(
      'button[type="submit"]'
    );

    if (saveButton) saveButton.disabled = true;

    try {
      const data = {
        name,
        price,
        stock,
        updatedAt: serverTimestamp()
      };

      if (productId.value) {
        await updateDoc(doc(db, "products", productId.value), data);
        showMessage("Product updated.");
      } else {
        await addDoc(collection(db, "products"), {
          ...data,
          createdAt: serverTimestamp()
        });

        showMessage("Product added.");
      }

      productForm.reset();
      productId.value = "";
    } catch (error) {
      console.error(error);
      showMessage("Could not save product. Check your connection.");
    } finally {
      if (saveButton) saveButton.disabled = false;
    }
  });

  // ==================================================
  // CART AND TOTALS
  // ==================================================

  function getSubtotal() {
    return cart.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0
    );
  }

  function getDiscount() {
    const discount = Math.max(0, Number(discountInput?.value) || 0);
    return Math.min(discount, getSubtotal());
  }

  function getGrandTotal() {
    return getSubtotal() - getDiscount();
  }

  function updateChange() {
    if (!cashInput || !changeElement) return;

    const cash = Number(cashInput.value) || 0;

    changeElement.textContent = formatMoney(
      Math.max(0, cash - getGrandTotal())
    );
  }

  function renderCart() {
    if (!cartItems) return;

    cartItems.replaceChildren();

    if (!cart.length) {
      showEmpty(cartItems, "Your cart is empty.");
    }

    cart.forEach((item) => {
      const row = makeElement("div", "cart-row");
      const details = makeElement("div", "cart-details");

      details.append(
        makeElement("strong", "", item.name),
        makeElement(
          "p",
          "muted",
          `${formatMoney(item.price)} each · ${formatMoney(item.price * item.quantity)}`
        )
      );

      const controls = makeElement("div", "cart-controls");

      controls.append(
        makeButton("−", "button secondary", () => {
          changeCartQuantity(item.id, -1);
        }),
        makeElement("span", "", String(item.quantity)),
        makeButton("＋", "button secondary", () => {
          changeCartQuantity(item.id, 1);
        }),
        makeButton("Remove", "button", () => {
          cart = cart.filter((entry) => entry.id !== item.id);
          renderCart();
        })
      );

      row.append(details, controls);
      cartItems.append(row);
    });

    if (subtotalElement) {
      subtotalElement.textContent = formatMoney(getSubtotal());
    }

    if (grandTotalElement) {
      grandTotalElement.textContent = formatMoney(getGrandTotal());
    }

    updateChange();
  }

  function addToCart(id) {
    const product = products.find((item) => item.id === id);

    if (!product) {
      showMessage("Product is not loaded.");
      return;
    }

    const current = cart.find((item) => item.id === id);
    const inCart = current?.quantity || 0;

    if (inCart >= availableStock(product)) {
      showMessage("Not enough available stock.");
      return;
    }

    if (current) {
      current.quantity += 1;
    } else {
      cart.push({
        id: product.id,
        name: product.name,
        price: Number(product.price),
        quantity: 1
      });
    }

    renderCart();
  }

  function changeCartQuantity(id, amount) {
    const item = cart.find((entry) => entry.id === id);
    const product = products.find((entry) => entry.id === id);

    if (!item || !product) return;

    const next = item.quantity + amount;

    if (next <= 0) {
      cart = cart.filter((entry) => entry.id !== id);
    } else if (
      next > availableStock(product) + item.quantity
    ) {
      showMessage("Quantity exceeds available stock.");
      return;
    } else {
      item.quantity = next;
    }

    renderCart();
  }

  discountInput?.addEventListener("input", renderCart);
  cashInput?.addEventListener("input", updateChange);

  $("clearCart")?.addEventListener("click", () => {
    cart = [];
    renderCart();
    showMessage("Cart cleared.");
  });

  // ==================================================
  // SAVE AN OFFLINE SALE LOCALLY
  // ==================================================

  function createLocalSale(items, subtotal, discount, cash) {
    return {
      id: makeSaleId(),
      items: items.map((item) => ({
        productId: item.id,
        name: item.name,
        price: item.price,
        quantity: item.quantity,
        lineTotal: item.price * item.quantity
      })),
      subtotal,
      discount,
      total: subtotal - discount,
      cashReceived: cash,
      change: cash - (subtotal - discount),
      createdAt: new Date().toISOString(),
      staffUid: currentUser.uid
    };
  }

  function saveOfflineSale(sale) {
    const nextQueue = [...pendingSales, sale];

    if (!saveQueue(nextQueue)) return false;

    pendingSales = nextQueue;
    sales = [
      ...sales.filter((item) => item.id !== sale.id),
      { ...sale, syncStatus: "pending" }
    ];

    updatePendingIndicator();
    renderProducts();
    renderHistory();

    return true;
  }

  // ==================================================
  // UPLOAD PENDING SALES
  // Stable document IDs and transactions prevent duplicate
  // stock deductions when an upload is retried.
  // ==================================================

  async function uploadSale(sale) {
    const saleRef = doc(db, "sales", sale.id);

    await runTransaction(db, async (transaction) => {
      const existingSale = await transaction.get(saleRef);

      // This ID already exists: never deduct stock a second time.
      if (existingSale.exists()) return;

      const productRecords = [];

      for (const item of sale.items) {
        const productRef = doc(db, "products", item.productId);
        const snapshot = await transaction.get(productRef);

        if (!snapshot.exists()) {
          throw new Error(`Product "${item.name}" no longer exists.`);
        }

        const data = snapshot.data();
        const stock = Number(data.stock) || 0;

        if (stock < item.quantity) {
          throw new Error(
            `Insufficient server stock for "${item.name}". ` +
            `Available: ${stock}; requested: ${item.quantity}.`
          );
        }

        productRecords.push({
          ref: productRef,
          data,
          quantity: item.quantity
        });
      }

      for (const item of productRecords) {
        transaction.update(item.ref, {
          stock: Number(item.data.stock) - item.quantity,
          updatedAt: serverTimestamp()
        });
      }

      transaction.set(saleRef, {
        items: sale.items,
        subtotal: sale.subtotal,
        discount: sale.discount,
        total: sale.total,
        cashReceived: sale.cashReceived,
        change: sale.change,
        staffUid: sale.staffUid,
        createdAt: new Date(sale.createdAt)
      });
    });
  }

  async function syncPendingSales() {
    if (
      syncingSales ||
      !navigator.onLine ||
      !auth.currentUser ||
      pendingSales.length === 0
    ) {
      updateConnectionStatus();
      return;
    }

    syncingSales = true;
    updateConnectionStatus();

    showMessage(`Syncing ${pendingSales.length} pending sale(s)...`);

    try {
      while (navigator.onLine && pendingSales.length > 0) {
        const sale = pendingSales[0];

        try {
          await uploadSale(sale);

          // Remove only after uploadSale succeeds.
          // If the upload fails, the sale stays in localStorage.
          const remaining = pendingSales.filter(
            (item) => item.id !== sale.id
          );

          if (!saveQueue(remaining)) {
            showMessage(
              "Sale reached Firebase, but local queue cleanup failed. It will be retried safely."
            );
            break;
          }

          pendingSales = remaining;

          sales = sales.map((item) =>
            item.id === sale.id
              ? { ...sale, syncStatus: "synced" }
              : item
          );

          renderHistory();
          renderProducts();
          updatePendingIndicator();

          showMessage(
            `Sale synced successfully. ${pendingSales.length} sale(s) remain.`
          );
        } catch (error) {
          console.error("Sale sync failed:", sale.id, error);

          showMessage(
            `A sale could not sync: ${error.message || "connection error"}. ` +
            "It remains saved locally. Check stock and reconnect before retrying."
          );

          break;
        }
      }

      if (pendingSales.length === 0) {
        showMessage(
          "All pending sales were confirmed by Firebase. Local queued sale data has been cleared."
        );
      }
    } finally {
      syncingSales = false;
      updateConnectionStatus();
      renderHistory();
    }
  }

  // ==================================================
  // CHECKOUT — ONLINE AND OFFLINE
  // ==================================================

  
$("completeSale")?.addEventListener("click", async () => {
  if (isCheckingOut) return;

  if (!cart.length) {
    showMessage("Add at least one product to the cart.");
    return;
  }

  if (!auth.currentUser) {
    showMessage("Your staff session is unavailable. Sign in again.");
    return;
  }

  const cartForSale = cart.map((item) => ({ ...item }));
  const subtotal = getSubtotal();
  const discount = getDiscount();
  const total = subtotal - discount;
  const cash = Number(cashInput?.value);

  if (!Number.isFinite(cash) || cash < total) {
    showMessage(
      "Cash received must be equal to or greater than the total."
    );
    return;
  }

  for (const item of cartForSale) {
    const product = products.find((entry) => entry.id === item.id);

    if (!product || availableStock(product) < item.quantity) {
      showMessage(`Not enough available stock for "${item.name}".`);
      return;
    }
  }

  isCheckingOut = true;

  const checkoutButton = $("completeSale");

  if (checkoutButton) {
    checkoutButton.disabled = true;
    checkoutButton.textContent = "Saving order...";
  }

  try {
    const sale = createLocalSale(
      cartForSale,
      subtotal,
      discount,
      cash
    );

    // IMPORTANT: save locally BEFORE clearing the cart or uploading.
    if (!saveOfflineSale(sale)) {
      throw new Error(
        "The order was NOT confirmed as saved. " +
        "Your cart has been kept. Check phone storage and browser settings."
      );
    }

    // Clear the cart only after local storage confirms the save.
    cart = [];

    if (discountInput) discountInput.value = "0";
    if (cashInput) cashInput.value = "";

    renderCart();

    // Show immediate confirmation for an offline sale.
    if (!navigator.onLine) {
      showSaleSavedModal({
        synced: false,
        count: pendingSales.length
      });

      showMessage(
        `Offline sale saved locally. ${pendingSales.length} sale(s) waiting to sync.`
      );

      return;
    }

    // If older sales are pending, do not hide the newly saved sale.
    if (pendingSales.length > 0) {
      await syncPendingSales();

      if (pendingSales.some((item) => item.id === sale.id)) {
        showSaleSavedModal({
          synced: false,
          count: pendingSales.length
        });
      } else {
        showSaleSavedModal({ synced: true });
      }

      return;
    }

    await syncPendingSales();

    if (pendingSales.some((item) => item.id === sale.id)) {
      showSaleSavedModal({
        synced: false,
        count: pendingSales.length
      });
    } else {
      showSaleSavedModal({ synced: true });
    }
  } catch (error) {
    console.error("Checkout failed:", error);
    showMessage(error.message || "Checkout failed. Please retry.");
  } finally {
    isCheckingOut = false;

    if (checkoutButton) {
      checkoutButton.disabled = false;
      checkoutButton.textContent = "Complete sale";
    }
  }
});


    try {
      // Reconcile earlier offline sales before accepting another
      // online sale. If reconciliation fails, queue this sale too.
      if (navigator.onLine && pendingSales.length > 0) {
        await syncPendingSales();
      }

      const sale = createLocalSale(
        cartForSale,
        subtotal,
        discount,
        cash
      );

      if (!navigator.onLine || pendingSales.length > 0) {
        if (!saveOfflineSale(sale)) {
          throw new Error(
            "The sale could not be stored locally. Do not close this page; reconnect and try again."
          );
        }

        cart = [];

        if (discountInput) discountInput.value = "0";
        if (cashInput) cashInput.value = "";

        renderCart();

        showMessage(
          `SALE SAVED LOCALLY — ${pendingSales.length} sale(s) waiting to sync.`
        );

        if (navigator.onLine) {
          await syncPendingSales();
        }

        return;
      }

      // Online sale: save locally first, then upload using the same ID.
      // This protects the sale if the connection drops mid-checkout.
      if (!saveOfflineSale(sale)) {
        throw new Error("Could not save a local recovery copy of the sale.");
      }

      cart = [];

      if (discountInput) discountInput.value = "0";
      if (cashInput) cashInput.value = "";

      renderCart();

      await syncPendingSales();
    } catch (error) {
      console.error("Checkout failed:", error);
      showMessage(error.message || "Checkout failed. Please retry.");
    } finally {
      isCheckingOut = false;

      if (checkoutButton) {
        checkoutButton.disabled = false;
        checkoutButton.textContent = "Complete sale";
      }
    }
  });

  // ==================================================
  // SHOPPING LIST
  // ==================================================

  function renderShopping() {
    if (!shoppingList) return;

    shoppingList.replaceChildren();

    if (!shoppingItems.length) {
      showEmpty(shoppingList, "Your shopping list is empty.");
    }

    let total = 0;

    shoppingItems.forEach((item) => {
      const price = Number(item.price) || 0;
      const quantity = Number(item.quantity) || 0;
      const lineTotal = price * quantity;

      total += lineTotal;

      const row = makeElement("div", "shopping-row");
      const details = makeElement("div", "shopping-details");

      details.append(
        makeElement("strong", "", item.name),
        makeElement(
          "p",
          "muted",
          `${formatMoney(price)} × ${quantity} = ${formatMoney(lineTotal)}`
        )
      );

      row.append(
        details,
        makeButton("Remove", "button", async () => {
          if (!navigator.onLine) {
            showMessage("Connect to the internet before changing the shopping list.");
            return;
          }

          try {
            await deleteDoc(doc(db, "shoppingItems", item.id));
            showMessage("Shopping item removed.");
          } catch (error) {
            console.error(error);
            showMessage("Could not remove shopping item.");
          }
        })
      );

      shoppingList.append(row);
    });

    if (shoppingTotal) {
      shoppingTotal.textContent = formatMoney(total);
    }

    if (budgetRemaining) {
      if (!shoppingBudget || shoppingBudget.value.trim() === "") {
        budgetRemaining.textContent = "—";
        budgetRemaining.classList.remove("over-budget");
      } else {
        const remaining = Number(shoppingBudget.value) - total;
        budgetRemaining.textContent = formatMoney(remaining);

        budgetRemaining.classList.toggle(
          "over-budget",
          remaining < 0
        );
      }
    }
  }

  shoppingForm?.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!navigator.onLine) {
      showMessage("Reconnect to add items to the shared shopping list.");
      return;
    }

    const name = $("shoppingName")?.value.trim();
    const price = Number($("shoppingPrice")?.value);
    const quantity = Number($("shoppingQty")?.value);

    if (
      !name ||
      !Number.isFinite(price) ||
      price < 0 ||
      !Number.isInteger(quantity) ||
      quantity < 1
    ) {
      showMessage("Enter a valid name, price, and quantity.");
      return;
    }

    try {
      await addDoc(collection(db, "shoppingItems"), {
        name,
        price,
        quantity,
        createdAt: serverTimestamp(),
        addedBy: currentUser.uid
      });

      shoppingForm.reset();

      if ($("shoppingQty")) $("shoppingQty").value = "1";

      showMessage("Shopping item saved.");
    } catch (error) {
      console.error(error);
      showMessage("Could not save shopping item.");
    }
  });

  shoppingBudget?.addEventListener("input", renderShopping);

  // ==================================================
  // SALES HISTORY
  // ==================================================

  function toDate(value) {
    if (value && typeof value.toDate === "function") {
      return value.toDate();
    }

    if (value instanceof Date) return value;

    if (typeof value === "string") {
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? null : date;
    }

    return null;
  }

  function renderHistory() {
    if (!historyList) return;

    historyList.replaceChildren();

    const sortedSales = [...sales].sort(
      (a, b) =>
        (toDate(b.createdAt)?.getTime() || 0) -
        (toDate(a.createdAt)?.getTime() || 0)
    );

    if (!sortedSales.length) {
      showEmpty(historyList, "No sales recorded yet.");
    }

    sortedSales.forEach((sale) => {
      const card = makeElement("article", "history-card");
      const date = toDate(sale.createdAt);

      const summary = (sale.items || [])
        .map((item) => `${item.name} × ${item.quantity}`)
        .join(", ");

      card.append(
        makeElement("h3", "", formatMoney(sale.total)),
        makeElement(
          "p",
          "muted",
          date ? date.toLocaleString() : "Date pending"
        ),
        makeElement("p", "", summary || "No item details"),
        makeElement(
          "p",
          "muted",
          `Subtotal: ${formatMoney(sale.subtotal)} · Discount: ${formatMoney(sale.discount)}`
        ),
        makeElement(
          "p",
          "muted",
          `Cash: ${formatMoney(sale.cashReceived)} · Change: ${formatMoney(sale.change)}`
        ),
        makeElement(
          "p",
          "sync-status",
          sale.syncStatus === "pending"
            ? "PENDING SYNC — saved on this device"
            : "Saved in sales history"
        )
      );

      card.append(
        makeButton("Delete sale", "button", async () => {
          if (sale.syncStatus === "pending") {
            if (
              !confirm(
                "Remove this unsynced sale from this device? It will not be recorded in Firebase."
              )
            ) return;

            pendingSales = pendingSales.filter(
              (item) => item.id !== sale.id
            );

            if (!saveQueue(pendingSales)) return;

            sales = sales.filter((item) => item.id !== sale.id);

            renderHistory();
            renderProducts();
            showMessage("Pending sale removed from this device.");
            return;
          }

          if (!navigator.onLine) {
            showMessage("Connect to the internet before deleting a synced sale.");
            return;
          }

          if (!confirm("Permanently delete this sales record?")) return;

          try {
            await deleteDoc(doc(db, "sales", sale.id));
            showMessage("Sales record deleted.");
          } catch (error) {
            console.error(error);
            showMessage("Could not delete sales record.");
          }
        })
      );

      historyList.append(card);
    });

    const now = new Date();

    const todaySales = sortedSales.filter((sale) => {
      const date = toDate(sale.createdAt);

      return (
        date &&
        date.getFullYear() === now.getFullYear() &&
        date.getMonth() === now.getMonth() &&
        date.getDate() === now.getDate()
      );
    });

    if ($("todaySales")) {
      $("todaySales").textContent = formatMoney(
        todaySales.reduce(
          (sum, sale) => sum + (Number(sale.total) || 0),
          0
        )
      );
    }

    if ($("todayCount")) {
      $("todayCount").textContent = String(todaySales.length);
    }
  }

  // Clear all history button
  let clearHistoryButton = $("clearHistory");

  if (!clearHistoryButton && historyList) {
    clearHistoryButton = makeButton(
      "Clear All History",
      "button",
      () => {}
    );

    clearHistoryButton.id = "clearHistory";

    historyList.insertAdjacentElement("beforebegin", clearHistoryButton);
  }

  clearHistoryButton?.addEventListener("click", async () => {
    if (!navigator.onLine) {
      showMessage("Connect to the internet before clearing history.");
      return;
    }

    if (pendingSales.length > 0) {
      showMessage(
        "Sync all pending sales before clearing history so unsynced sales are not lost."
      );
      return;
    }

    if (!confirm("Permanently delete all sales history? Export a backup first if needed.")) {
      return;
    }

    clearHistoryButton.disabled = true;

    try {
      const snapshot = await getDocs(collection(db, "sales"));

      for (let i = 0; i < snapshot.docs.length; i += 450) {
        const batch = writeBatch(db);

        snapshot.docs.slice(i, i + 450).forEach((saleDoc) => {
          batch.delete(saleDoc.ref);
        });

        await batch.commit();
      }

      showMessage(`Deleted ${snapshot.size} sales record(s).`);
    } catch (error) {
      console.error(error);
      showMessage("Could not clear all history.");
    } finally {
      clearHistoryButton.disabled = false;
    }
  });

  // ==================================================
  // FIRESTORE LISTENERS
  // ==================================================

  onSnapshot(
    collection(db, "products"),
    { includeMetadataChanges: true },
    (snapshot) => {
      products = snapshot.docs.map((item) => ({
        id: item.id,
        ...item.data()
      }));

      productSnapshotFromServer =
        !snapshot.metadata.fromCache &&
        !snapshot.metadata.hasPendingWrites;

      renderProducts();

      if (cart.length) renderCart();

      updateConnectionStatus();
    },
    (error) => {
      console.error("Product listener failed:", error);
      showMessage("Could not load products. Check connection and permissions.");
    }
  );

  onSnapshot(
    collection(db, "sales"),
    { includeMetadataChanges: true },
    (snapshot) => {
      const serverSales = snapshot.docs.map((item) => ({
        id: item.id,
        ...item.data(),
        syncStatus: "synced"
      }));

      salesSnapshotFromServer =
        !snapshot.metadata.fromCache &&
        !snapshot.metadata.hasPendingWrites;

      // Keep pending local sales visible until their uploads are confirmed.
      const localPending = pendingSales.map((sale) => ({
        ...sale,
        syncStatus: "pending"
      }));

      const serverIds = new Set(serverSales.map((sale) => sale.id));

      sales = [
        ...serverSales,
        ...localPending.filter((sale) => !serverIds.has(sale.id))
      ];

      renderHistory();
      updateConnectionStatus();
    },
    (error) => {
      console.error("Sales listener failed:", error);
      showMessage("Could not load sales history.");
    }
  );

  onSnapshot(
    collection(db, "shoppingItems"),
    { includeMetadataChanges: true },
    (snapshot) => {
      shoppingItems = snapshot.docs.map((item) => ({
        id: item.id,
        ...item.data()
      }));

      shoppingSnapshotFromServer =
        !snapshot.metadata.fromCache &&
        !snapshot.metadata.hasPendingWrites;

      renderShopping();
      updateConnectionStatus();
    },
    (error) => {
      console.error("Shopping list listener failed:", error);
      showMessage("Could not load shopping list.");
    }
  );

  // ==================================================
  // INITIAL DISPLAY AND AUTOMATIC RETRY
  // ==================================================

  renderProducts();
  renderCart();
  renderShopping();
  renderHistory();
  updateConnectionStatus();

  if (navigator.onLine && pendingSales.length > 0) {
    await syncPendingSales();
  }
});
