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
  // GENERAL HELPERS AND NOTIFICATIONS
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

  // ==================================================
  // AUTHENTICATION AND OFFLINE STAFF VERIFICATION
  // ==================================================

  const logoutButton = $("logoutButton");

  logoutButton?.addEventListener("click", async () => {
    if (!confirm("Are you sure you want to log out?")) return;

    logoutButton.disabled = true;
    logoutButton.textContent = "Logging out...";

    try {
      await signOut(auth);
      window.location.replace("./login.html");
    } catch (error) {
      console.error("Logout failed:", error);

      showMessage("Unable to log out. Please try again.");

      logoutButton.disabled = false;
      logoutButton.textContent = "Logout";
    }
  });

  try {
    await offlineReady;

    const user = await waitForUser();

    if (!user) {
      window.location.replace("./login.html");
      return;
    }

    let staffSnapshot;

    try {
      staffSnapshot = await getDoc(doc(db, "staff", user.uid));
    } catch (onlineCheckError) {
      if (!navigator.onLine) {
        try {
          staffSnapshot = await getDocFromCache(
            doc(db, "staff", user.uid)
          );
        } catch (cacheError) {
          throw new Error(
            "Staff approval is not available offline. Connect to the internet and open the app once before using it offline."
          );
        }
      } else {
        throw onlineCheckError;
      }
    }

    if (
      !staffSnapshot.exists() ||
      staffSnapshot.data().approved !== true
    ) {
      if (navigator.onLine) {
        await signOut(auth);
      }

      window.location.replace("./login.html");
      return;
    }

  } catch (error) {
    console.error("Authentication check failed:", error);

    document.body.textContent = navigator.onLine
      ? "Unable to verify staff access. Please reload and try again."
      : "Unable to verify staff access offline. Connect to the internet and open the app once so staff approval can be cached.";

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

    pages.forEach((page) => {
      page.classList.remove("active");
    });

    navButtons.forEach((button) => {
      button.classList.remove("active");
    });

    targetPage.classList.add("active");

    document
      .querySelector(`.nav-button[data-page="${targetId}"]`)
      ?.classList.add("active");

    window.scrollTo({
      top: 0,
      behavior: "smooth"
    });
  }

  navButtons.forEach((button) => {
    button.addEventListener("click", () => {
      openPage(button.dataset.page);
    });
  });

  document.querySelectorAll("[data-open]").forEach((button) => {
    button.addEventListener("click", () => {
      openPage(button.dataset.open);
    });
  });

  // ==================================================
  // CONNECTION STATUS AND AUTO-SYNC NOTIFICATIONS
  // ==================================================

  function updateConnectionStatus() {
    const status = $("connectionStatus");

    if (!status) return;

    if (!navigator.onLine) {
      status.textContent =
        "Offline — saved changes will sync when online";

      status.classList.add("offline");

      showMessage(
        "You are offline. Supported changes are saved locally and will sync when online."
      );

      return;
    }

    status.classList.remove("offline");

    const allServerConfirmed =
      productSnapshotFromServer &&
      salesSnapshotFromServer &&
      shoppingSnapshotFromServer;

    status.textContent = allServerConfirmed
      ? "Online — synced with Firebase"
      : "Online — syncing with Firebase...";
  }

  window.addEventListener("online", () => {
    updateConnectionStatus();

    showMessage(
      "Connection restored. Checking and syncing pending changes with Firebase..."
    );
  });

  window.addEventListener("offline", updateConnectionStatus);

  updateConnectionStatus();

  // ==================================================
  // PRODUCT MANAGEMENT AND POS PRODUCT CARDS
  // ==================================================

  function makeProductCard(product, forPOS = false) {
    const card = makeElement("article", "product-card");

    card.append(
      makeElement("h3", "", product.name || "Unnamed product"),
      makeElement("p", "", formatMoney(product.price)),
      makeElement(
        "p",
        "muted",
        `Stock: ${Number(product.stock) || 0}`
      )
    );

    if (forPOS) {
      card.append(
        makeElement(
          "p",
          "muted",
          Number(product.stock) > 0
            ? "Available"
            : "Out of stock"
        )
      );

      const addButton = makeButton(
        Number(product.stock) > 0
          ? "Add to cart"
          : "Out of stock",
        "button primary full",
        () => addToCart(product.id)
      );

      addButton.disabled = Number(product.stock) <= 0;

      card.append(addButton);

      return card;
    }

    const actions = makeElement("div", "product-actions");

    const editButton = makeButton("Edit", "button", () => {
      productId.value = product.id;
      productName.value = product.name;
      productPrice.value = product.price;
      productStock.value = product.stock;

      openPage("productsPage");

      productName.focus();
    });

    const deleteButton = makeButton(
      "Delete",
      "button",
      async () => {
        if (
          !confirm(
            `Delete "${product.name}"? This cannot be undone.`
          )
        ) {
          return;
        }

        try {
          await deleteDoc(doc(db, "products", product.id));

          showMessage(
            navigator.onLine
              ? "Product deleted."
              : "Product deletion queued locally; it should sync when online."
          );
        } catch (error) {
          console.error("Delete product failed:", error);

          showMessage(
            "Could not delete product. Check connection and Firestore rules."
          );
        }
      }
    );

    actions.append(editButton, deleteButton);
    card.append(actions);

    return card;
  }

  function renderProducts() {
    productList?.replaceChildren();
    posProducts?.replaceChildren();

    if (!products.length) {
      showEmpty(productList, "No products added yet.");

      showEmpty(
        posProducts,
        "No products available. Add products or reconnect to load saved products."
      );

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
      showMessage(
        "Enter a product name, a price greater than zero, and a whole-number stock."
      );

      return;
    }

    const saveButton = productForm.querySelector(
      'button[type="submit"]'
    );

    if (saveButton) saveButton.disabled = true;

    const editingProduct = Boolean(productId.value);

    try {
      const data = {
        name,
        price,
        stock,
        updatedAt: serverTimestamp()
      };

      let writePromise;

      if (editingProduct) {
        writePromise = updateDoc(
          doc(db, "products", productId.value),
          data
        );
      } else {
        writePromise = addDoc(collection(db, "products"), {
          ...data,
          createdAt: serverTimestamp()
        });
      }

      if (!navigator.onLine) {
        showMessage(
          "Offline — product change is queued locally and will sync when online if Firestore persistence is available."
        );

        productForm.reset();

        if (productId) productId.value = "";

        writePromise
          .then(() => {
            showMessage("Product change synced with Firebase.");
          })
          .catch((error) => {
            console.error("Queued product write failed:", error);

            showMessage(
              "Product change did not sync. Reconnect and try again."
            );
          });
      } else {
        await writePromise;

        showMessage(
          editingProduct
            ? "Product updated and saved to Firebase."
            : "Product added and saved to Firebase."
        );

        productForm.reset();

        if (productId) productId.value = "";
      }
    } catch (error) {
      console.error("Saving product failed:", error);

      showMessage(
        "Could not save product. Check your connection and Firestore permissions."
      );
    } finally {
      if (saveButton) saveButton.disabled = false;
    }
  });

  // ==================================================
  // POS CART
  // ==================================================

  function getSubtotal() {
    return cart.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0
    );
  }

  function getDiscount() {
    const discount = Number(discountInput?.value) || 0;

    return Math.min(
      Math.max(discount, 0),
      getSubtotal()
    );
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
          `${formatMoney(item.price)} each · ${formatMoney(
            item.price * item.quantity
          )}`
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
          showMessage(`${item.name} removed from cart.`);
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
      return showMessage(
        "Product not found in the loaded product list."
      );
    }

    const current = cart.find((item) => item.id === id);
    const quantity = current ? current.quantity : 0;

    if (quantity >= Number(product.stock)) {
      return showMessage("Not enough stock available.");
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

    showMessage(
      `${product.name} added to cart. Checkout still requires internet to verify stock safely.`
    );
  }

  function changeCartQuantity(id, amount) {
    const item = cart.find((entry) => entry.id === id);
    const product = products.find((entry) => entry.id === id);

    if (!item || !product) return;

    const nextQuantity = item.quantity + amount;

    if (nextQuantity <= 0) {
      cart = cart.filter((entry) => entry.id !== id);
    } else if (nextQuantity > Number(product.stock)) {
      return showMessage("Quantity exceeds available stock.");
    } else {
      item.quantity = nextQuantity;
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
  // CHECKOUT
  // Checkout requires internet for accurate stock and sales.
  // ==================================================

  $("completeSale")?.addEventListener("click", async () => {
    if (isCheckingOut) return;

    if (!cart.length) {
      return showMessage("Add at least one product to the cart.");
    }

    if (!navigator.onLine) {
      showMessage(
        "Offline mode: you can build the cart, but checkout is disabled until internet returns so stock and sales remain accurate."
      );

      return;
    }

    const subtotal = getSubtotal();
    const discount = getDiscount();
    const total = subtotal - discount;
    const cash = Number(cashInput?.value);

    if (!Number.isFinite(cash) || cash < total) {
      return showMessage(
        "Cash received must be equal to or greater than the total."
      );
    }

    if (!auth.currentUser) {
      return showMessage(
        "Your staff session is unavailable. Please sign in again."
      );
    }

    const checkoutButton = $("completeSale");
    const cartForSale = cart.map((item) => ({ ...item }));
    const saleRef = doc(collection(db, "sales"));

    isCheckingOut = true;

    if (checkoutButton) {
      checkoutButton.disabled = true;
      checkoutButton.textContent = "Processing...";
    }

    try {
      await runTransaction(db, async (transaction) => {
        const freshProducts = [];

        for (const item of cartForSale) {
          const productRef = doc(db, "products", item.id);
          const snapshot = await transaction.get(productRef);

          if (!snapshot.exists()) {
            throw new Error(
              `Product "${item.name}" no longer exists.`
            );
          }

          const data = snapshot.data();
          const currentStock = Number(data.stock) || 0;

          if (currentStock < item.quantity) {
            throw new Error(
              `Insufficient stock for "${data.name}". Available: ${currentStock}.`
            );
          }

          const currentPrice = Number(data.price);

          if (
            !Number.isFinite(currentPrice) ||
            currentPrice < 0
          ) {
            throw new Error(
              `Invalid price for "${data.name}".`
            );
          }

          freshProducts.push({
            ref: productRef,
            data,
            quantity: item.quantity
          });
        }

        for (const item of freshProducts) {
          transaction.update(item.ref, {
            stock: Number(item.data.stock) - item.quantity,
            updatedAt: serverTimestamp()
          });
        }

        transaction.set(saleRef, {
          items: cartForSale.map((item) => ({
            productId: item.id,
            name: item.name,
            price: item.price,
            quantity: item.quantity,
            lineTotal: item.price * item.quantity
          })),

          subtotal,
          discount,
          total,
          cashReceived: cash,
          change: cash - total,
          createdAt: serverTimestamp(),
          staffUid: auth.currentUser.uid
        });
      });

      cart = [];

      if (discountInput) discountInput.value = "0";
      if (cashInput) cashInput.value = "";

      renderCart();

      showMessage(
        "Sale saved to Firebase! Stock and sales history were updated."
      );
    } catch (error) {
      console.error("Checkout failed:", error);

      showMessage(
        error.message || "Sale failed. Check your connection and try again."
      );
    } finally {
      isCheckingOut = false;

      if (checkoutButton) {
        checkoutButton.disabled = false;
        checkoutButton.textContent = "Complete sale";
      }
    }
  });

  // ==================================================
  // SHOPPING LIST AND BUDGET
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

      const removeButton = makeButton(
        "Remove",
        "button",
        async () => {
          try {
            const deletion = deleteDoc(
              doc(db, "shoppingItems", item.id)
            );

            if (!navigator.onLine) {
              showMessage(
                "Offline — removal queued locally and should sync when online."
              );

              deletion
                .then(() => {
                  showMessage("Shopping item removal synced with Firebase.");
                })
                .catch((error) => {
                  console.error(
                    "Queued shopping deletion failed:",
                    error
                  );

                  showMessage(
                    "Shopping item removal did not sync. Reconnect and try again."
                  );
                });
            } else {
              await deletion;

              showMessage("Shopping item removed and synced.");
            }
          } catch (error) {
            console.error(
              "Removing shopping item failed:",
              error
            );

            showMessage(
              "Could not remove item. Check connection and permissions."
            );
          }
        }
      );

      row.append(details, removeButton);
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
      return showMessage(
        "Enter a valid item name, price, and whole-number quantity."
      );
    }

    if (!auth.currentUser) {
      return showMessage("Please sign in again before adding an item.");
    }

    try {
      const writePromise = addDoc(
        collection(db, "shoppingItems"),
        {
          name,
          price,
          quantity,
          createdAt: serverTimestamp(),
          addedBy: auth.currentUser.uid
        }
      );

      if (!navigator.onLine) {
        shoppingForm.reset();

        if ($("shoppingQty")) {
          $("shoppingQty").value = "1";
        }

        showMessage(
          "Offline — shopping item queued locally and should sync when online."
        );

        writePromise
          .then(() => {
            showMessage("Shopping item synced with Firebase.");
          })
          .catch((error) => {
            console.error("Queued shopping write failed:", error);

            showMessage(
              "Shopping item did not sync. Reconnect and try again."
            );
          });
      } else {
        await writePromise;

        shoppingForm.reset();

        if ($("shoppingQty")) {
          $("shoppingQty").value = "1";
        }

        showMessage("Item added and saved to Firebase.");
      }
    } catch (error) {
      console.error("Adding shopping item failed:", error);

      showMessage(
        "Could not add item. Check connection and Firestore rules."
      );
    }
  });

  shoppingBudget?.addEventListener("input", renderShopping);

  // ==================================================
  // SALES HISTORY
  // DELETE INDIVIDUAL SALE AND CLEAR ALL HISTORY
  // ==================================================

  function toDate(timestamp) {
    if (timestamp && typeof timestamp.toDate === "function") {
      return timestamp.toDate();
    }

    if (timestamp instanceof Date) {
      return timestamp;
    }

    return null;
  }

  function renderHistory() {
    if (!historyList) return;

    historyList.replaceChildren();

    const sortedSales = [...sales].sort((a, b) => {
      return (
        (toDate(b.createdAt)?.getTime() || 0) -
        (toDate(a.createdAt)?.getTime() || 0)
      );
    });

    if (!sortedSales.length) {
      showEmpty(historyList, "No sales recorded yet.");
    }

    sortedSales.forEach((sale) => {
      const card = makeElement("article", "history-card");
      const date = toDate(sale.createdAt);

      const itemSummary = (sale.items || [])
        .map((item) => `${item.name} × ${item.quantity}`)
        .join(", ");

      card.append(
        makeElement("h3", "", formatMoney(sale.total)),
        makeElement(
          "p",
          "muted",
          date ? date.toLocaleString() : "Timestamp pending..."
        ),
        makeElement("p", "", itemSummary || "No item details"),
        makeElement(
          "p",
          "muted",
          `Subtotal: ${formatMoney(sale.subtotal)} · Discount: ${formatMoney(sale.discount)}`
        ),
        makeElement(
          "p",
          "muted",
          `Cash: ${formatMoney(sale.cashReceived)} · Change: ${formatMoney(sale.change)}`
        )
      );

      const deleteButton = makeButton(
        "Delete sale",
        "button",
        async () => {
          if (!navigator.onLine) {
            return showMessage(
              "Connect to the internet before deleting a sales record."
            );
          }

          if (
            !confirm(
              "Permanently delete this sales record? This cannot be undone."
            )
          ) {
            return;
          }

          deleteButton.disabled = true;

          try {
            await deleteDoc(doc(db, "sales", sale.id));

            showMessage("Sales record deleted from Firebase.");
          } catch (error) {
            console.error("Delete sale failed:", error);

            showMessage(
              "Could not delete this sale. Check Firestore rules and connection."
            );

            deleteButton.disabled = false;
          }
        }
      );

      card.append(deleteButton);
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

  // Add a Clear All History button if it is missing from index.html.
  let clearHistoryButton = $("clearHistory");

  if (!clearHistoryButton && historyList) {
    clearHistoryButton = makeButton(
      "Clear All History",
      "button",
      () => {}
    );

    clearHistoryButton.id = "clearHistory";

    historyList.insertAdjacentElement(
      "beforebegin",
      clearHistoryButton
    );
  }

  clearHistoryButton?.addEventListener("click", async () => {
    if (!navigator.onLine) {
      return showMessage(
        "Connect to the internet before clearing sales history."
      );
    }

    if (
      !confirm(
        "Permanently delete ALL sales history? This cannot be undone. Export a backup first if you need these records."
      )
    ) {
      return;
    }

    const button = clearHistoryButton;

    if (button) {
      button.disabled = true;
      button.textContent = "Deleting...";
    }

    try {
      const snapshot = await getDocs(collection(db, "sales"));
      const saleDocs = snapshot.docs;

      // Firestore batches allow up to 500 write operations.
      for (let i = 0; i < saleDocs.length; i += 450) {
        const batch = writeBatch(db);

        saleDocs
          .slice(i, i + 450)
          .forEach((saleDoc) => {
            batch.delete(saleDoc.ref);
          });

        await batch.commit();
      }

      showMessage(
        `Deleted ${saleDocs.length} sales record(s). History cleared.`
      );
    } catch (error) {
      console.error("Clear history failed:", error);

      showMessage(
        "Could not clear all history. Some records may remain; check connection and permissions."
      );
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = "Clear All History";
      }
    }
  });

  // ==================================================
  // REAL-TIME FIRESTORE LISTENERS
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
      renderCart();

      if (snapshot.metadata.hasPendingWrites) {
        showMessage(
          "Saving product changes — they will sync with Firebase when the connection is available."
        );
      } else if (snapshot.metadata.fromCache) {
        showMessage(
          navigator.onLine
            ? "Showing cached products. Waiting for Firebase confirmation..."
            : "Offline — showing saved products. Pending changes will sync when online."
        );
      } else {
        showMessage("Products synced with Firebase.");
      }

      updateConnectionStatus();
    },
    (error) => {
      console.error("Loading products failed:", error);

      showMessage(
        "Could not load products. Check connection and Firestore rules."
      );
    }
  );

  onSnapshot(
    collection(db, "sales"),
    { includeMetadataChanges: true },
    (snapshot) => {
      sales = snapshot.docs.map((item) => ({
        id: item.id,
        ...item.data()
      }));

      salesSnapshotFromServer =
        !snapshot.metadata.fromCache &&
        !snapshot.metadata.hasPendingWrites;

      renderHistory();
      updateConnectionStatus();
    },
    (error) => {
      console.error("Loading sales failed:", error);

      showMessage(
        "Could not load sales history. Check connection and Firestore rules."
      );
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
      console.error("Loading shopping list failed:", error);

      showMessage(
        "Could not load shopping list. Check connection and Firestore rules."
      );
    }
  );

  renderProducts();
  renderCart();
  renderShopping();
  renderHistory();
});
