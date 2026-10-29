
import {
  collection,
  addDoc,
  onSnapshot,
  doc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  getDoc,
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
  // AUTHENTICATION AND LOGOUT
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
      alert("Unable to log out. Please try again.");
      logoutButton.disabled = false;
      logoutButton.textContent = "Logout";
    }
  });

  function waitForUser() {
    return new Promise((resolve) => {
      const unsubscribe = onAuthStateChanged(auth, (user) => {
        unsubscribe();
        resolve(user);
      });
    });
  }

  try {
    const user = await waitForUser();

    if (!user) {
      window.location.replace("./login.html");
      return;
    }

    const staffSnapshot = await getDoc(doc(db, "staff", user.uid));

    if (
      !staffSnapshot.exists() ||
      staffSnapshot.data().approved !== true
    ) {
      await signOut(auth);
      window.location.replace("./login.html");
      return;
    }

    await offlineReady;
  } catch (error) {
    console.error("Authentication check failed:", error);
    document.body.textContent =
      "Unable to verify staff access. Please reconnect to the internet and reload.";
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

  // ==================================================
  // GENERAL HELPERS
  // ==================================================

  function showMessage(message) {
    let notice = $("appNotice");

    if (!notice) {
      notice = document.createElement("p");
      notice.id = "appNotice";
      notice.setAttribute("role", "status");

      const header = document.querySelector(".topbar");

      if (header) {
        header.insertAdjacentElement("afterend", notice);
      } else {
        document.body.prepend(notice);
      }
    }

    notice.textContent = message;
  }

  function openPage(targetId) {
    const targetPage = $(targetId);
    if (!targetPage) return;

    pages.forEach((page) => page.classList.remove("active"));
    navButtons.forEach((button) => button.classList.remove("active"));

    targetPage.classList.add("active");

    const matchingNav = document.querySelector(
      `.nav-button[data-page="${targetId}"]`
    );

    matchingNav?.classList.add("active");
    window.scrollTo({ top: 0, behavior: "smooth" });
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

// ==================================================
// ONLINE / OFFLINE AND SYNC STATUS
// ==================================================

function updateConnectionStatus() {
  const status = $("connectionStatus");
  if (!status) return;

  if (!navigator.onLine) {
    status.textContent =
      "Offline — saved changes will sync when online";
    status.classList.add("offline");
  } else {
    status.textContent =
      "Online — checking Firebase sync...";
    status.classList.remove("offline");
  }
}

window.addEventListener("online", updateConnectionStatus);
window.addEventListener("offline", updateConnectionStatus);

updateConnectionStatus();

  // ==================================================
  // PRODUCT MANAGEMENT
  // ==================================================

  function makeProductCard(product, forPOS = false) {
    const card = makeElement("article", "product-card");

    card.append(
      makeElement("h3", "", product.name),
      makeElement("p", "", formatMoney(product.price)),
      makeElement("p", "muted", `Stock: ${product.stock}`)
    );

    if (forPOS) {
      card.append(
        makeElement(
          "p",
          "muted",
          product.stock > 0 ? "Available" : "Out of stock"
        )
      );

      const addButton = makeButton(
        product.stock > 0 ? "Add to cart" : "Out of stock",
        "button primary full",
        () => addToCart(product.id)
      );

      addButton.disabled = product.stock <= 0;
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

    const deleteButton = makeButton("Delete", "button", async () => {
      if (!confirm(`Delete "${product.name}"? This cannot be undone.`)) {
        return;
      }

      try {
        await deleteDoc(doc(db, "products", product.id));
        showMessage("Product deleted.");
      } catch (error) {
        console.error("Delete product failed:", error);
        showMessage("Could not delete product. Check Firestore rules.");
      }
    });

    actions.append(editButton, deleteButton);
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
      showMessage(
        "Enter a product name, a price greater than zero, and a whole-number stock."
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
        await updateDoc(
          doc(db, "products", productId.value),
          data
        );

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
      console.error("Saving product failed:", error);

      showMessage(
        navigator.onLine
          ? "Could not save product. Check Firestore permissions."
          : "Offline: change may be queued. Reconnect and verify synchronization."
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
    return Math.min(Math.max(discount, 0), getSubtotal());
  }

  function getGrandTotal() {
    return getSubtotal() - getDiscount();
  }

  function updateChange() {
    if (!cashInput || !changeElement) return;

    const cash = Number(cashInput.value) || 0;
    const change = cash - getGrandTotal();

    changeElement.textContent = formatMoney(Math.max(0, change));
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
        makeButton("+", "button secondary", () => {
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
      showMessage("Product not found.");
      return;
    }

    const current = cart.find((item) => item.id === id);
    const quantity = current ? current.quantity : 0;

    if (quantity >= Number(product.stock)) {
      showMessage("Not enough stock available.");
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

    const nextQuantity = item.quantity + amount;

    if (nextQuantity <= 0) {
      cart = cart.filter((entry) => entry.id !== id);
    } else if (nextQuantity > Number(product.stock)) {
      showMessage("Quantity exceeds available stock.");
      return;
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
  // CHECKOUT AND STOCK UPDATES
  // ==================================================

  $("completeSale")?.addEventListener("click", async () => {
    if (isCheckingOut) return;

    if (!cart.length) {
      showMessage("Add at least one product to the cart.");
      return;
    }

    // A transaction is required to safely validate shared stock.
    if (!navigator.onLine) {
      showMessage(
        "Checkout requires an internet connection to verify stock safely."
      );
      return;
    }

    const subtotal = getSubtotal();
    const discount = getDiscount();
    const total = subtotal - discount;
    const cash = Number(cashInput?.value);

    if (!Number.isFinite(cash) || cash < total) {
      showMessage("Cash received must be equal to or greater than the total.");
      return;
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

        // Read all products first.
        for (const item of cartForSale) {
          const productRef = doc(db, "products", item.id);
          const snapshot = await transaction.get(productRef);

          if (!snapshot.exists()) {
            throw new Error(`Product "${item.name}" no longer exists.`);
          }

          const data = snapshot.data();
          const currentStock = Number(data.stock) || 0;

          if (currentStock < item.quantity) {
            throw new Error(
              `Insufficient stock for "${data.name}". Available: ${currentStock}.`
            );
          }

          const currentPrice = Number(data.price);

          if (!Number.isFinite(currentPrice) || currentPrice < 0) {
            throw new Error(`Invalid price for "${data.name}".`);
          }

          freshProducts.push({
            ref: productRef,
            data,
            quantity: item.quantity
          });
        }

        // Update stock only after all products pass validation.
        for (const item of freshProducts) {
          transaction.update(item.ref, {
            stock: Number(item.data.stock) - item.quantity,
            updatedAt: serverTimestamp()
          });
        }

        // Create the sale record.
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
      showMessage("Sale completed! Stock and sales history were updated.");
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
  // SHARED SHOPPING LIST AND BUDGET CALCULATOR
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

      const removeButton = makeButton("Remove", "button", async () => {
        try {
          await deleteDoc(doc(db, "shoppingItems", item.id));
          showMessage("Shopping item removed.");
        } catch (error) {
          console.error("Removing shopping item failed:", error);
          showMessage("Could not remove item. Check connection and permissions.");
        }
      });

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
        const budget = Number(shoppingBudget.value);
        const remaining = budget - total;

        budgetRemaining.textContent = formatMoney(remaining);
        budgetRemaining.classList.toggle("over-budget", remaining < 0);
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
      showMessage("Enter a valid item name, price, and whole-number quantity.");
      return;
    }

    try {
      await addDoc(collection(db, "shoppingItems"), {
        name,
        price,
        quantity,
        createdAt: serverTimestamp(),
        addedBy: auth.currentUser.uid
      });

      shoppingForm.reset();

      if ($("shoppingQty")) {
        $("shoppingQty").value = "1";
      }

      showMessage("Item added to the shared shopping list.");
    } catch (error) {
      console.error("Adding shopping item failed:", error);
      showMessage("Could not add item. Check connection and Firestore rules.");
    }
  });

  shoppingBudget?.addEventListener("input", renderShopping);

  // ==================================================
  // SALES HISTORY AND TODAY'S TOTALS
  // ==================================================

  function toDate(timestamp) {
    if (timestamp && typeof timestamp.toDate === "function") {
      return timestamp.toDate();
    }

    if (timestamp instanceof Date) return timestamp;

    return null;
  }

  function renderHistory() {
    if (!historyList) return;

    historyList.replaceChildren();

    const sortedSales = [...sales].sort((a, b) => {
      const dateA = toDate(a.createdAt)?.getTime() || 0;
      const dateB = toDate(b.createdAt)?.getTime() || 0;
      return dateB - dateA;
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

      historyList.append(card);
    });

    const now = new Date();

    const todaySales = sortedSales.filter((sale) => {
      const date = toDate(sale.createdAt);

      return date &&
        date.getFullYear() === now.getFullYear() &&
        date.getMonth() === now.getMonth() &&
        date.getDate() === now.getDate();
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

  // ==================================================
  // REAL-TIME FIRESTORE SYNCHRONIZATION
  // ==================================================

  onSnapshot(
    collection(db, "products"),
    { includeMetadataChanges: true },
    (snapshot) => {
      products = snapshot.docs.map((item) => ({
        id: item.id,
        ...item.data()
      }));

      renderProducts();
      renderCart();

      showMessage(
        snapshot.metadata.fromCache
          ? "Showing cached products. Cloud updates may be pending."
          : "Products synced with Firebase."
      );
    },
    (error) => {
      console.error("Loading products failed:", error);
      showMessage("Could not load products. Check Firestore rules.");
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

      renderHistory();
    },
    (error) => {
      console.error("Loading sales failed:", error);
      showMessage("Could not load sales history. Check Firestore rules.");
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

      renderShopping();
    },
    (error) => {
      console.error("Loading shopping list failed:", error);
      showMessage("Could not load shopping list. Check Firestore rules.");
    }
  );

  renderProducts();
  renderCart();
  renderShopping();
  renderHistory();
});
