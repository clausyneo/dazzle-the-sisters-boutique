const menuButton = document.querySelector(".menu-toggle");
const menuPanel = document.querySelector("#menu-panel");
const siteHeader = document.querySelector(".site-header");
const API_BASE_URL = window.DAZZLE_CONFIG.API_BASE_URL;

if (menuButton && menuPanel && siteHeader) {
  function setMenuOpen(isOpen) {
    menuButton.setAttribute("aria-expanded", String(isOpen));
    menuPanel.classList.toggle("is-open", isOpen);
    menuPanel.setAttribute("aria-hidden", String(!isOpen));
    if (isOpen) {
      menuPanel.removeAttribute("inert");
    } else {
      menuPanel.setAttribute("inert", "");
    }
  }

  const pageName = window.location.pathname.split("/").pop() || "index.html";
  const currentPage = pageName === "shop.html" || pageName === "product-details.html"
    ? "shop"
    : pageName === "cart.html" || pageName === "checkout.html" || pageName === "order-confirmation.html"
      ? "cart"
      : pageName === "order-tracking.html"
        ? "order-tracking"
        : pageName === "account-login.html"
          ? "account-login"
          : pageName === "account-register.html"
            ? "account-register"
            : pageName === "my-account.html"
              ? "my-account"
              : pageName === "measurement-studio.html"
                ? "measurement-studio"
        : pageName === "index.html" || pageName === ""
          ? window.location.hash.slice(1) || "home"
          : "";

  siteHeader.querySelectorAll("[data-page]").forEach((link) => {
    if (link.dataset.page === currentPage) {
      link.setAttribute("aria-current", "page");
    }
  });

  menuButton.addEventListener("click", () => {
    setMenuOpen(menuButton.getAttribute("aria-expanded") !== "true");
  });

  menuPanel.addEventListener("click", (event) => {
    if (event.target.closest("a")) {
      setMenuOpen(false);
    }
  });

  document.addEventListener("pointerdown", (event) => {
    if (menuButton.getAttribute("aria-expanded") === "true" &&
        !siteHeader.contains(event.target)) {
      setMenuOpen(false);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && menuButton.getAttribute("aria-expanded") === "true") {
      setMenuOpen(false);
      menuButton.focus();
    }
  });
}

async function accountApiRequest(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers
    }
  });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error("The account service returned an unreadable response.");
  }
  if (!response.ok || result.success !== true) {
    const error = new Error(result.message || "Unable to complete the account request.");
    error.status = response.status;
    throw error;
  }
  return result;
}

window.DAZZLE_ACCOUNT_API = accountApiRequest;

function setAccountMenu(customer) {
  if (!menuPanel) return;
  let accountLinks = menuPanel.querySelector(".menu-account-links");
  if (!accountLinks) {
    accountLinks = document.createElement("div");
    accountLinks.className = "menu-account-links";
    menuPanel.append(accountLinks);
  }
  accountLinks.replaceChildren();

  let measurementLink = menuPanel.querySelector('a[data-page="measurement-studio"]');
  if (!measurementLink) {
    measurementLink = document.createElement("a");
    measurementLink.href = "measurement-studio.html";
    measurementLink.dataset.page = "measurement-studio";
    measurementLink.textContent = "Royal Measurement Studio";
    accountLinks.append(measurementLink);
  }

  if (customer) {
    const accountLink = document.createElement("a");
    accountLink.href = "my-account.html";
    accountLink.dataset.page = "my-account";
    accountLink.textContent = "My Account";
    accountLinks.append(accountLink);

    const logoutButton = document.createElement("button");
    logoutButton.type = "button";
    logoutButton.className = "menu-account-logout";
    logoutButton.textContent = "Log Out";
    logoutButton.addEventListener("click", async () => {
      logoutButton.disabled = true;
      try {
        await accountApiRequest("/api/account/logout", { method: "POST" });
        window.location.href = "account-login.html";
      } catch (error) {
        logoutButton.disabled = false;
        window.alert(error.message);
      }
    });
    accountLinks.append(logoutButton);
  } else {
    const loginLink = document.createElement("a");
    loginLink.href = "account-login.html";
    loginLink.dataset.page = "account-login";
    loginLink.textContent = "Login";
    const registerLink = document.createElement("a");
    registerLink.href = "account-register.html";
    registerLink.dataset.page = "account-register";
    registerLink.textContent = "Register";
    accountLinks.append(loginLink, registerLink);
  }

  const currentPage = window.location.pathname.split("/").pop();
  accountLinks.querySelectorAll("[data-page]").forEach((link) => {
    if ((currentPage === "measurement-studio.html" && link.dataset.page === "measurement-studio") ||
        (currentPage === "my-account.html" && link.dataset.page === "my-account") ||
        (currentPage === "account-login.html" && link.dataset.page === "account-login") ||
        (currentPage === "account-register.html" && link.dataset.page === "account-register")) {
      link.setAttribute("aria-current", "page");
    }
  });
}

if (menuPanel) {
  accountApiRequest("/api/account/me")
    .then((result) => setAccountMenu(result.customer))
    .catch(() => setAccountMenu(null));
}

const products = [
  // Demo inventory quantities; update these sample values when real stock is available.
  {
    id: "meera-floral-kurti", name: "Meera Floral Kurti", category: "Kurtis",
    price: 1499, image: "assets/images/products/01-ivory-floral-kurti.jpg",
    imageAlt: "Mannequin in an ivory floral kurti, illustrative image for Meera Floral Kurti",
    description: "A floral everyday kurti with a soft, easy-to-style look for casual outings.",
    sizes: ["XS", "S", "M", "L", "XL", "XXL"], stock: 5
  },
  {
    id: "gulabi-everyday-kurti", name: "Gulabi Everyday Kurti", category: "Kurtis",
    price: 1899, image: "assets/images/products/06-pink-floral-kurti.jpg",
    imageAlt: "Mannequin in a pink floral kurti, illustrative image for Gulabi Everyday Kurti",
    description: "A cheerful kurti designed for comfortable everyday wear.",
    sizes: ["XS", "S", "M", "L", "XL", "XXL"], stock: 3
  },
  {
    id: "noor-embroidered-suit", name: "Noor Embroidered Suit", category: "Salwar Suits",
    price: 3299, image: "assets/images/products/07-purple-embroidered-suit.jpg",
    imageAlt: "Mannequin in a purple embroidered salwar suit, illustrative image for Noor Embroidered Suit",
    description: "A graceful suit set with embroidery details for family gatherings and celebrations.",
    sizes: ["XS", "S", "M", "L", "XL", "XXL"], stock: 6
  },
  {
    id: "zari-festive-suit-set", name: "Zari Festive Suit Set", category: "Salwar Suits",
    price: 4599, image: "assets/images/products/09-teal-festive-suit.jpg",
    imageAlt: "Mannequin in a teal festive salwar suit, illustrative image for Zari Festive Suit Set",
    description: "A festive suit set with a polished look for special occasions.",
    sizes: ["XS", "S", "M", "L", "XL", "XXL"], stock: 4
  },
  {
    id: "rani-celebration-lehenga", name: "Rani Celebration Lehenga", category: "Lehengas",
    price: 7999, image: "assets/images/products/13-bridal-maroon-lehenga.jpg",
    imageAlt: "Mannequin in a bridal maroon lehenga, illustrative image for Rani Celebration Lehenga",
    description: "A celebration-ready lehenga in a rich, traditional colour palette.",
    sizes: ["XS", "S", "M", "L", "XL", "XXL"], stock: 0
  },
  {
    id: "gulnaar-party-lehenga", name: "Gulnaar Party Lehenga", category: "Lehengas",
    price: 6899, image: "assets/images/products/14-pink-designer-lehenga.jpg",
    imageAlt: "Mannequin in a pink designer lehenga, illustrative image for Gulnaar Party Lehenga",
    description: "A festive lehenga made for parties, receptions, and joyful occasions.",
    sizes: ["XS", "S", "M", "L", "XL", "XXL"], stock: 6
  },
  {
    id: "madhuri-woven-saree", name: "Madhuri Woven Saree", category: "Sarees",
    price: 3799, image: "assets/images/products/21-green-banarasi-saree.jpg",
    imageAlt: "Mannequin in a green Banarasi saree, illustrative image for Madhuri Woven Saree",
    description: "A classic woven saree that brings timeless style to your occasion wear.",
    sizes: [], blouseIncluded: false, stock: 8
  },
  {
    id: "chandni-festive-saree", name: "Chandni Festive Saree", category: "Sarees",
    price: 5499, image: "assets/images/products/19-wine-embroidered-saree.jpg",
    imageAlt: "Mannequin in a wine embroidered saree, illustrative image for Chandni Festive Saree",
    description: "A festive saree with an elegant look for celebrations and evening events.",
    sizes: [], blouseIncluded: false, stock: 4
  },
  {
    id: "aarohi-anarkali-suit", name: "Aarohi Anarkali Suit", category: "Anarkali Suits",
    price: 4299, image: "assets/images/products/25-bottle-green-anarkali.jpg",
    imageAlt: "Mannequin in a bottle-green Anarkali suit, illustrative image for Aarohi Anarkali Suit",
    description: "A flowing Anarkali suit with a graceful silhouette for special gatherings.",
    sizes: ["XS", "S", "M", "L", "XL", "XXL"], stock: 3
  },
  {
    id: "saanvi-printed-anarkali", name: "Saanvi Printed Anarkali", category: "Anarkali Suits",
    price: 2899, image: "assets/images/products/27-ivory-floral-anarkali.jpg",
    imageAlt: "Mannequin in an ivory floral Anarkali suit, illustrative image for Saanvi Printed Anarkali",
    description: "A printed Anarkali suit with a light, easy-to-wear feel.",
    sizes: ["XS", "S", "M", "L", "XL", "XXL"], stock: 7
  },
  {
    id: "ira-printed-co-ord-set", name: "Ira Printed Co-ord Set", category: "Co-ord Sets",
    price: 2499, image: "assets/images/products/28-purple-printed-coord.jpg",
    imageAlt: "Mannequin in a purple printed co-ord set, illustrative image for Ira Printed Co-ord Set",
    description: "A coordinated printed set for a relaxed yet put-together outfit.",
    sizes: ["XS", "S", "M", "L", "XL", "XXL"], stock: 5
  },
  {
    id: "sitara-embroidered-co-ord", name: "Sitara Embroidered Co-ord", category: "Co-ord Sets",
    price: 3599, image: "assets/images/products/30-black-embroidered-coord.jpg",
    imageAlt: "Mannequin in a black embroidered co-ord set, illustrative image for Sitara Embroidered Co-ord",
    description: "An embroidered co-ord set with thoughtful details for festive occasions.",
    sizes: ["XS", "S", "M", "L", "XL", "XXL"], stock: 1
  },
  {
    id: "maroon-embroidered-kurti",
    name: "Maroon Embroidered Kurti",
    category: "Kurtis",
    price: 1499,
    image: "assets/images/products/02-maroon-embroidered-kurti.jpg",
    imageAlt: "Mannequin wearing a maroon embroidered kurti",
    description: "An elegant maroon embroidered kurti for festive occasions and everyday styling.",
    sizes: ["XS", "S", "M", "L", "XL", "XXL"],
    stock: 2
},
  ];

const sizeChartRows = [
  ["XS", "32–33 / 81–84", "26–27 / 66–69", "36–37 / 91–94"],
  ["S", "34–35 / 86–89", "28–29 / 71–74", "38–39 / 97–99"],
  ["M", "36–37 / 91–94", "30–31 / 76–79", "40–41 / 102–104"],
  ["L", "38–39 / 97–99", "32–33 / 81–84", "42–43 / 107–109"],
  ["XL", "40–41 / 102–104", "34–35 / 86–89", "44–45 / 112–114"],
  ["XXL", "42–43 / 107–109", "36–37 / 91–94", "46–47 / 117–119"],
  ["3XL", "44–46 / 112–117", "38–40 / 97–102", "48–50 / 122–127"]
];

const sizeCharts = {
  Kurtis: {
    columns: ["Size", "Bust", "Waist", "Hip", "Shoulder", "Kurti length*"],
    rows: sizeChartRows.map(([size, bust, waist, hip], index) => [
      size, bust, waist, hip,
      ["13–13.5 / 33–34", "13.5–14 / 34–36", "14–14.5 / 36–37", "14.5–15 / 37–38", "15–15.5 / 38–39", "15.5–16 / 39–41", "16–16.5 / 41–42"][index],
      ["40–42 / 102–107", "40–42 / 102–107", "42–44 / 107–112", "42–44 / 107–112", "44–46 / 112–117", "44–46 / 112–117", "44–46 / 112–117"][index]
    ]),
    notes: ["Circumferences are body measurements. Kurti length is a desired garment length, not a body measurement."]
  },
  "Salwar Suits": {
    columns: ["Size", "Top bust", "Top waist", "Top hip", "Trouser waist", "Trouser length*"],
    rows: sizeChartRows.map(([size, bust, waist, hip], index) => [
      size, bust, waist, hip, waist,
      ["38–39 / 97–99", "38–39 / 97–99", "39–40 / 99–102", "39–40 / 99–102", "40–41 / 102–104", "40–41 / 102–104", "40–41 / 102–104"][index]
    ]),
    notes: ["Circumferences are body measurements. Trouser length is measured to the hem point you prefer."]
  },
  Lehengas: {
    columns: ["Size", "Blouse bust", "Lehenga waist", "Hip", "Skirt length*"],
    rows: sizeChartRows.map(([size, bust, waist, hip], index) => [
      size, bust, waist, hip,
      ["40–42 / 102–107", "40–42 / 102–107", "42–44 / 107–112", "42–44 / 107–112", "44–46 / 112–117", "44–46 / 112–117", "44–46 / 112–117"][index]
    ]),
    notes: [
      "For waist-to-floor length, measure vertically from where the waistband will sit down to the floor while barefoot.",
      "Tell your stitcher the heel height or footwear allowance you want added to the skirt length."
    ]
  },
  Sarees: {
    columns: ["Blouse size", "Bust", "Underbust", "Blouse waist", "Blouse length*"],
    rows: [
      ["XS", "32–33 / 81–84", "28–29 / 71–74", "26–27 / 66–69", "13–14 / 33–36"],
      ["S", "34–35 / 86–89", "30–31 / 76–79", "28–29 / 71–74", "13–14 / 33–36"],
      ["M", "36–37 / 91–94", "32–33 / 81–84", "30–31 / 76–79", "14–15 / 36–38"],
      ["L", "38–39 / 97–99", "34–35 / 86–89", "32–33 / 81–84", "14–15 / 36–38"],
      ["XL", "40–41 / 102–104", "36–37 / 91–94", "34–35 / 86–89", "15–16 / 38–41"],
      ["XXL", "42–43 / 107–109", "38–39 / 97–99", "36–37 / 91–94", "15–16 / 38–41"],
      ["3XL", "44–46 / 112–117", "40–42 / 102–107", "38–40 / 97–102", "15–16 / 38–41"]
    ],
    intro: "Saree fabric is generally free-size rather than XS–XXL. A commonly used fabric length is about 5.5 m; check each product for exact length and whether blouse fabric is included. This separate chart is for a stitched blouse; blouse body values are inches / centimetres.",
    notes: ["Blouse length is a desired garment length, measured from the shoulder near the neck to the preferred hem."]
  },
  "Anarkali Suits": {
    columns: ["Size", "Bust", "Waist", "Hip", "Shoulder", "Full length*"],
    rows: sizeChartRows.map(([size, bust, waist, hip], index) => [
      size, bust, waist, hip,
      ["13–13.5 / 33–34", "13.5–14 / 34–36", "14–14.5 / 36–37", "14.5–15 / 37–38", "15–15.5 / 38–39", "15.5–16 / 39–41", "16–16.5 / 41–42"][index],
      ["52–54 / 132–137", "52–54 / 132–137", "54–56 / 137–142", "54–56 / 137–142", "56–58 / 142–147", "56–58 / 142–147", "58–60 / 147–152"][index]
    ]),
    notes: ["Circumferences are body measurements. Full length is a desired garment length, measured from the high shoulder point to the hem."]
  },
  "Co-ord Sets": {
    columns: ["Size", "Bust", "Waist", "Hip", "Top length*", "Bottom waist", "Bottom length*"],
    rows: sizeChartRows.map(([size, bust, waist, hip], index) => [
      size, bust, waist, hip,
      ["24–25 / 61–64", "24–25 / 61–64", "25–26 / 64–66", "25–26 / 64–66", "26–27 / 66–69", "26–27 / 66–69", "27–28 / 69–71"][index],
      waist,
      ["38–39 / 97–99", "38–39 / 97–99", "39–40 / 99–102", "39–40 / 99–102", "40–41 / 102–104", "40–41 / 102–104", "40–41 / 102–104"][index]
    ]),
    notes: ["Circumferences are body measurements. Top and bottom lengths are desired garment lengths."]
  }
};

const cartStorageKey = "dazzleCart";

function formatPrice(price) {
  return `₹${price.toLocaleString("en-IN")}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[character]);
}

async function fetchProductAvailability(productId) {
  const response = await fetch(
    `${API_BASE_URL}/api/products/${encodeURIComponent(productId)}/availability`
  );
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error("The availability service returned an unreadable response.");
  }

  if (!result || typeof result !== "object" ||
      !response.ok || result.success !== true ||
      result.productId !== productId || !Array.isArray(result.sizes) ||
      !result.sizes.every((size) =>
        size &&
        typeof size.size === "string" &&
        Number.isSafeInteger(size.availableQuantity) &&
        size.availableQuantity >= 0
      )) {
    throw new Error(result?.message || "Unable to load current size availability.");
  }

  return new Map(result.sizes.map((size) => [size.size, size.availableQuantity]));
}

function getSizeStock(availability, size) {
  return availability.has(size) ? availability.get(size) : null;
}

function productImage(product, extraClass = "") {
  const imageClass = extraClass ? `${extraClass} product-art` : "product-art";

  if (!product.image) {
    return `<div class="${imageClass} product-image-placeholder" role="img" aria-label="No licensed ${product.category.toLowerCase()} photo available"><span>Photo coming soon</span></div>`;
  }

  return `<img class="${imageClass}" src="${product.image}" alt="${product.imageAlt}" loading="lazy" decoding="async">`;
}

function renderSizeGuide(category) {
  const chart = sizeCharts[category];
  const tableHeadings = chart.columns.map((column) => `<th scope="col">${column}</th>`).join("");
  const tableRows = chart.rows.map((row) => `
    <tr>${row.map((value) => `<td>${value}</td>`).join("")}</tr>
  `).join("");

  return `
    <p class="size-guide-intro">${chart.intro || "Values are inches / centimetres. Circumferences are body measurements; lengths are desired garment lengths."}</p>
    <div class="size-chart-scroll" tabindex="0" role="region" aria-label="${category} size chart, scroll horizontally if needed">
      <table class="size-chart">
        <thead><tr>${tableHeadings}</tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>
    <ul class="size-guide-notes">
      ${chart.notes.map((note) => `<li>${note}</li>`).join("")}
    </ul>
    <section class="measurement-instructions">
      <h3>How to take your measurements</h3>
      <ul>
        <li><strong>Bust:</strong> Measure around the fullest part, keeping the tape level across your back.</li>
        <li><strong>Waist:</strong> Measure around your natural waist without pulling the tape tight. For a lehenga, also note where its waistband will sit.</li>
        <li><strong>Hips:</strong> Measure around the fullest part of your hips and seat, with feet together.</li>
        <li><strong>Shoulder:</strong> Measure across your back from the tip of one shoulder to the other.</li>
        <li><strong>Garment length:</strong> Measure from the stated starting point, such as the high shoulder or waistband, to your preferred hem.</li>
        ${category === "Lehengas" ? "<li><strong>Waist-to-floor:</strong> Measure from the lehenga waistband position straight down to the floor while barefoot. Tell your stitcher your heel height or footwear allowance.</li>" : ""}
      </ul>
    </section>
    <p class="custom-fit-note"><strong>Custom stitching:</strong> Share your actual body measurements. Stitching ease is added separately when deciding finished garment measurements; do not add it to your body measurements.</p>
    <p class="size-guide-reference">
      These are Dazzle boutique recommendations, not universal sizing standards. Fit varies by brand, design, fabric and preference.
      Measurement guidance was checked against <a href="https://www.indianrani.com/pages/size-guide" target="_blank" rel="noopener noreferrer">Indian Rani</a>
      and <a href="https://sfcc-uat.biba.in/on/demandware.store/Sites-BibaGlobal-Site/en_US/Product-SizeGuide?pid=SKDSUZDR10042AW25EMGR" target="_blank" rel="noopener noreferrer">Biba</a>.
      The supplied BIS document returned 404 and the Aza page returned 403 when checked.
    </p>
  `;
}

function readCart() {
  const savedCart = localStorage.getItem(cartStorageKey);

  if (!savedCart) {
    return [];
  }

  let savedItems;

  try {
    savedItems = JSON.parse(savedCart);
  } catch (error) {
    console.error("The saved cart could not be read. It has been cleared.", error);
    localStorage.removeItem(cartStorageKey);
    return [];
  }

  if (!Array.isArray(savedItems)) {
    console.error("The saved cart data is invalid. It has been cleared.");
    localStorage.removeItem(cartStorageKey);
    return [];
  }

  const validItems = [];
  let cartWasAdjusted = false;

  for (const item of savedItems) {
    if (!item || typeof item.id !== "string" || typeof item.size !== "string" ||
        !Number.isInteger(item.quantity) || item.quantity < 1) {
      cartWasAdjusted = true;
      continue;
    }

    const product = products.find((currentProduct) => currentProduct.id === item.id);
    if (!product) {
      cartWasAdjusted = true;
      continue;
    }

    const validSize = product.sizes.length
      ? product.sizes.includes(item.size)
      : item.size === "Free size" || item.size === "Free Size";
    if (!validSize) {
      cartWasAdjusted = true;
      continue;
    }

    const size = product.sizes.length ? item.size : "Free Size";
    const existingItem = validItems.find((currentItem) => currentItem.id === item.id && currentItem.size === size);
    if (existingItem) {
      existingItem.quantity += item.quantity;
    } else {
      validItems.push({ id: item.id, size, quantity: item.quantity });
    }
  }

  if (cartWasAdjusted || JSON.stringify(validItems) !== savedCart) {
    localStorage.setItem(cartStorageKey, JSON.stringify(validItems));
  }

  return validItems;
}

function updateCartCount() {
  const itemCount = readCart().reduce((total, item) => total + item.quantity, 0);

  document.querySelectorAll(".cart-count").forEach((count) => {
    count.textContent = itemCount;
  });
}

function getSizeQuantity(cartItems, productId, size) {
  return cartItems
    .filter((item) => item.id === productId && item.size === size)
    .reduce((total, item) => total + item.quantity, 0);
}

function getRemainingStock(cartItems, productId, size, availableQuantity) {
  return Math.max(0, availableQuantity - getSizeQuantity(cartItems, productId, size));
}

function saveCart(cartItems) {
  const savedItems = cartItems.map(({ id, size, quantity }) => ({ id, size, quantity }));
  localStorage.setItem(cartStorageKey, JSON.stringify(savedItems));
  updateCartCount();
}

updateCartCount();

const productGrid = document.querySelector("#product-grid");

if (productGrid) {
  const searchInput = document.querySelector("#product-search");
  const filterButtons = document.querySelectorAll(".filter-button");
  const mobileGridSelector = document.querySelector("#mobile-grid-columns");
  const mobileGridStorageKey = "dazzleMobileProductColumns";

  if (mobileGridSelector) {
    let selectedColumns = "2";
    try {
      const savedColumns = sessionStorage.getItem(mobileGridStorageKey);
      if (savedColumns === "2" || savedColumns === "3") {
        selectedColumns = savedColumns;
      }
    } catch {
      console.warn("Could not restore the mobile product grid preference.");
    }

    productGrid.dataset.mobileColumns = selectedColumns;
    mobileGridSelector.querySelector(`input[value="${selectedColumns}"]`).checked = true;
    mobileGridSelector.querySelectorAll(".grid-choice").forEach((choice) => {
      choice.classList.toggle("is-selected", choice.querySelector("input").value === selectedColumns);
    });
    mobileGridSelector.addEventListener("change", (event) => {
      const selectedInput = event.target.closest('input[name="mobile-grid-columns"]');
      if (!selectedInput || (selectedInput.value !== "2" && selectedInput.value !== "3")) {
        return;
      }

      productGrid.dataset.mobileColumns = selectedInput.value;
      mobileGridSelector.querySelectorAll(".grid-choice").forEach((choice) => {
        choice.classList.toggle("is-selected", choice.querySelector("input") === selectedInput);
      });
      try {
        sessionStorage.setItem(mobileGridStorageKey, selectedInput.value);
      } catch {
        console.warn("Could not save the mobile product grid preference.");
      }
    });
  }

  function getCategorySlug(category) {
    return category.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  const requestedCategory = new URLSearchParams(window.location.search).get("category");
  const initialCategoryButton = Array.from(filterButtons).find((button) =>
    getCategorySlug(button.dataset.category) === requestedCategory?.toLowerCase()
  );
  let selectedCategory = initialCategoryButton?.dataset.category || "All";

  function selectCategory(selectedButton) {
    selectedCategory = selectedButton.dataset.category;
    filterButtons.forEach((button) => {
      const isSelected = button === selectedButton;
      button.classList.toggle("is-selected", isSelected);
      button.setAttribute("aria-pressed", String(isSelected));
    });

    const url = new URL(window.location.href);
    if (selectedCategory === "All") {
      url.searchParams.delete("category");
    } else {
      url.searchParams.set("category", getCategorySlug(selectedCategory));
    }
    window.history.replaceState({}, "", url);
    displayProducts();
  }

  function displayProducts() {
    const searchText = searchInput.value.trim().toLowerCase();
    const matchingProducts = products.filter((product) => {
      const matchesCategory = selectedCategory === "All" || product.category === selectedCategory;
      const matchesName = product.name.toLowerCase().includes(searchText);

      return matchesCategory && matchesName;
    });

    productGrid.innerHTML = matchingProducts.map((product) => `
      <a class="product-card" href="product-details.html?id=${encodeURIComponent(product.id)}">
        ${productImage(product)}
        <div class="product-info">
          <p class="product-category">${product.category}</p>
          <h2>${product.name}</h2>
          <p class="product-price">${formatPrice(product.price)}</p>
          <span class="view-details">View Details</span>
        </div>
      </a>
    `).join("");

    const emptyMessage = document.querySelector("#empty-message");
    emptyMessage.hidden = matchingProducts.length > 0;
  }

  filterButtons.forEach((button) => {
    button.addEventListener("click", () => selectCategory(button));
  });

  selectCategory(initialCategoryButton || filterButtons[0]);
  searchInput.addEventListener("input", displayProducts);
}

const productDetails = document.querySelector("#product-details");
let refreshProductStock = null;

if (productDetails) {
  const productId = new URLSearchParams(window.location.search).get("id");
  const selectedProduct = products.find((product) => product.id === productId);
  const productNotFound = document.querySelector("#product-not-found");

  if (selectedProduct) {
    const needsSize = selectedProduct.sizes.length > 0 || selectedProduct.blouseIncluded;
    const supportedSizes = selectedProduct.sizes.length
      ? selectedProduct.sizes
      : ["Free Size"];
    const sizeOptions = supportedSizes
      .map((size) => `<option value="${size}">${size}</option>`)
      .join("");
    const sizingDescription = `
      <label for="product-size">Select your ${selectedProduct.blouseIncluded ? "blouse " : ""}size</label>
      <select id="product-size" required ${needsSize ? "" : "aria-label=\"Saree size\""}>
        ${needsSize ? '<option value="">Select Size</option>' : ""}
        ${sizeOptions}
      </select>
      ${needsSize ? "" : "<p>Saree fabric is free size; this sample product does not include a stitched blouse.</p>"}`;

    productDetails.innerHTML = `
      ${productImage(selectedProduct)}
      <div class="product-detail-info">
        <p class="product-category">${selectedProduct.category}</p>
        <h1 class="product-detail-title">${selectedProduct.name}</h1>
        <p class="product-detail-price">${formatPrice(selectedProduct.price)}</p>
        <p class="product-description">${selectedProduct.description}</p>
        <p class="sample-note">Where shown, photos are illustrative references, not verified Dazzle products or boutique photos.</p>
        <div class="product-sizes">
          ${sizingDescription}
          <p class="size-stock-message" id="size-stock-message" role="status" aria-live="polite">Checking size availability…</p>
          <button class="text-link size-guide-link" id="open-size-guide" type="button">Size Guide</button>
        </div>
        <button class="button button-burgundy add-to-cart" type="button" disabled>Add to Cart</button>
        <p class="inventory-note">Availability is checked using current server inventory.</p>
        <p class="cart-feedback" id="cart-feedback" aria-live="polite"></p>
      </div>
    `;
    productDetails.hidden = false;
    document.title = `${selectedProduct.name} | Dazzle The Sister's Boutique`;

    const stockMessage = document.querySelector("#size-stock-message");
    const sizeSelect = productDetails.querySelector("#product-size");
    const addToCartButton = productDetails.querySelector(".add-to-cart");
    let availability = null;
    let availabilityError = "";
    let isLoadingAvailability = true;

    function selectedSize() {
      return sizeSelect.value === "Free size" ? "Free Size" : sizeSelect.value;
    }

    function updateSizeOptions(currentAvailability) {
      for (const option of sizeSelect.options) {
        if (!option.value) continue;
        const quantity = getSizeStock(currentAvailability, option.value);
        option.textContent = quantity === null
          ? `${option.value} — Availability unavailable`
          : quantity === 0
            ? `${option.value} — Out of Stock`
            : `${option.value} — ${quantity} available`;
      }
    }

    function updateStockMessage(cartItems = readCart()) {
      if (isLoadingAvailability) {
        stockMessage.textContent = "Checking size availability…";
        addToCartButton.disabled = true;
        return;
      }
      if (availabilityError) {
        stockMessage.textContent = availabilityError;
        addToCartButton.disabled = true;
        return;
      }

      const currentSize = selectedSize();
      if (needsSize && !currentSize) {
        stockMessage.textContent = "Select a size to see current availability.";
        addToCartButton.disabled = true;
        return;
      }
      const quantity = getSizeStock(availability, currentSize);
      if (quantity === null) {
        stockMessage.textContent = `${currentSize}: Availability is not listed. Please contact the boutique.`;
        addToCartButton.disabled = true;
        return;
      }

      const remaining = getRemainingStock(cartItems, selectedProduct.id, currentSize, quantity);
      stockMessage.textContent = quantity === 0
        ? `${currentSize}: Out of Stock.`
        : `${currentSize}: ${quantity} available${remaining < quantity ? `; ${remaining} remaining after your cart quantity` : ""}.`;
      addToCartButton.disabled = quantity === 0 || remaining === 0;
    }

    async function loadAvailability() {
      isLoadingAvailability = true;
      availabilityError = "";
      updateStockMessage();
      try {
        availability = await fetchProductAvailability(selectedProduct.id);
        updateSizeOptions(availability);
      } catch (error) {
        availabilityError = error instanceof TypeError
          ? "Unable to connect to the availability service. Please try again."
          : error.message;
      } finally {
        isLoadingAvailability = false;
        updateStockMessage();
      }
    }

    refreshProductStock = loadAvailability;
    sizeSelect.addEventListener("change", () => {
      document.querySelector("#cart-feedback").textContent = "";
      if (availabilityError) {
        loadAvailability();
      } else {
        updateStockMessage();
      }
    });
    loadAvailability();

    const sizeGuideDialog = document.querySelector("#size-guide-dialog");
    document.querySelector("#open-size-guide").addEventListener("click", () => {
      document.querySelector("#size-guide-content").innerHTML = renderSizeGuide(selectedProduct.category);
      sizeGuideDialog.showModal();
    });
    document.querySelector("#close-size-guide").addEventListener("click", () => sizeGuideDialog.close());
    sizeGuideDialog.addEventListener("click", (event) => {
      if (event.target === sizeGuideDialog) {
        sizeGuideDialog.close();
      }
    });

    addToCartButton.addEventListener("click", async () => {
      const cartItems = readCart();
      const size = selectedSize();
      const cartFeedback = document.querySelector("#cart-feedback");

      if (needsSize && !size) {
        cartFeedback.textContent = "Please select your size first.";
        return;
      }

      addToCartButton.disabled = true;
      cartFeedback.textContent = "Refreshing size availability…";
      try {
        availability = await fetchProductAvailability(selectedProduct.id);
        availabilityError = "";
        updateSizeOptions(availability);
      } catch (error) {
        cartFeedback.textContent = error instanceof TypeError
          ? "Unable to connect to the availability service. Please try again."
          : error.message;
        availabilityError = cartFeedback.textContent;
        updateStockMessage(cartItems);
        return;
      }

      const availableQuantity = getSizeStock(availability, size);
      const remainingStock = availableQuantity === null
        ? 0
        : getRemainingStock(cartItems, selectedProduct.id, size, availableQuantity);
      if (availableQuantity === null || remainingStock === 0) {
        cartFeedback.textContent = availableQuantity === 0
          ? `${size} is out of stock.`
          : availableQuantity === null
            ? `Availability for ${size} is not listed. Please contact the boutique.`
            : `Only ${availableQuantity} ${size} available; that quantity is already in your cart.`;
        updateStockMessage(cartItems);
        return;
      }

      const existingItem = cartItems.find((item) =>
        item.id === selectedProduct.id && item.size === size
      );
      if (existingItem) {
        existingItem.quantity += 1;
      } else {
        cartItems.push({ id: selectedProduct.id, size, quantity: 1 });
      }

      saveCart(cartItems);
      updateStockMessage(cartItems);
      cartFeedback.textContent = `${selectedProduct.name} (${size}) added to your cart.`;
    });

    sizeSelect.addEventListener("change", () => {
      document.querySelector("#cart-feedback").textContent = "";
    });
  } else {
    productNotFound.hidden = false;
  }
}

const cartList = document.querySelector("#cart-items");
let refreshCart = null;
const checkoutAttemptStorageKey = "dazzleCheckoutAttempt";
const confirmationStorageKey = "dazzleOrderConfirmation";

if (cartList) {
  const cartContent = document.querySelector("#cart-content");
  const emptyCart = document.querySelector("#empty-cart");
  const subtotalElement = document.querySelector("#cart-subtotal");
  const checkoutButton = document.querySelector("#checkout-button");
  let cartRenderVersion = 0;

  async function renderCart() {
    const renderVersion = ++cartRenderVersion;
    const cartItems = readCart();
    const productsInCart = cartItems.map((item) => {
      const product = products.find((currentProduct) => currentProduct.id === item.id);
      return { ...product, size: item.size, quantity: item.quantity };
    });

    cartContent.hidden = productsInCart.length === 0;
    emptyCart.hidden = productsInCart.length > 0;
    checkoutButton.disabled = true;
    if (productsInCart.length === 0) {
      cartList.replaceChildren();
      subtotalElement.textContent = formatPrice(0);
      return;
    }

    cartList.innerHTML = productsInCart.map((product) => `
      <article class="cart-item">
        ${productImage(product, "cart-item-art")}
        <div class="cart-item-info">
          <p class="product-category">${product.category}</p>
          <h2>${product.name}</h2>
          <p class="cart-item-size">Size: ${product.size}</p>
          <p class="cart-item-price">${formatPrice(product.price)} each</p>
          <p class="cart-stock-message">Checking ${product.size} availability…</p>
          <div class="quantity-control" aria-label="Quantity for ${product.name}, size ${product.size}">
            <button type="button" data-action="decrease" data-id="${product.id}" data-size="${product.size}" aria-label="Decrease quantity">−</button>
            <span>${product.quantity}</span>
            <button type="button" data-action="increase" data-id="${product.id}" data-size="${product.size}" aria-label="Increase quantity" disabled>+</button>
          </div>
          <p class="cart-stock-warning" hidden></p>
        </div>
        <div class="cart-item-total-area">
          <p class="cart-item-total">${formatPrice(product.price * product.quantity)}</p>
          <button class="remove-item" type="button" data-action="remove" data-id="${product.id}" data-size="${product.size}">Remove</button>
        </div>
      </article>
    `).join("");

    const availabilityByProduct = new Map();
    await Promise.all([...new Set(productsInCart.map((product) => product.id))].map(async (productId) => {
      try {
        availabilityByProduct.set(productId, {
          sizes: await fetchProductAvailability(productId),
          error: ""
        });
      } catch (error) {
        availabilityByProduct.set(productId, {
          sizes: null,
          error: error instanceof TypeError
            ? "Unable to connect to the availability service. Please try again."
            : error.message
        });
      }
    }));

    if (renderVersion !== cartRenderVersion) return;

    let canProceedToCheckout = true;
    cartList.innerHTML = productsInCart.map((product) => {
      const currentAvailability = availabilityByProduct.get(product.id);
      const availableQuantity = currentAvailability?.sizes
        ? getSizeStock(currentAvailability.sizes, product.size)
        : null;
      const remainingStock = availableQuantity === null
        ? 0
        : getRemainingStock(cartItems, product.id, product.size, availableQuantity);
      const availabilityError = currentAvailability?.error || "";
      const stockLimitReached = availableQuantity === null || remainingStock === 0;
      let stockMessage;
      let warning = "";

      if (availabilityError) {
        stockMessage = `Availability error: ${availabilityError}`;
        warning = "Live availability could not be checked. Try again before checkout.";
        canProceedToCheckout = false;
      } else if (availableQuantity === null) {
        stockMessage = `Availability for ${product.size} is not listed.`;
        warning = "This size is unavailable. Remove this item or contact the boutique.";
        canProceedToCheckout = false;
      } else if (product.quantity > availableQuantity) {
        stockMessage = `${availableQuantity} ${product.size} available; your cart has ${product.quantity}.`;
        warning = "Reduce this quantity to the available amount before checkout.";
        canProceedToCheckout = false;
      } else if (availableQuantity === 0) {
        stockMessage = `${product.size}: Out of Stock.`;
        warning = "Remove this item before checkout.";
        canProceedToCheckout = false;
      } else {
        stockMessage = `${product.size}: ${availableQuantity} available; ${remainingStock} remaining.`;
      }

      return `
        <article class="cart-item">
          ${productImage(product, "cart-item-art")}
          <div class="cart-item-info">
            <p class="product-category">${product.category}</p>
            <h2>${product.name}</h2>
            <p class="cart-item-size">Size: ${product.size}</p>
            <p class="cart-item-price">${formatPrice(product.price)} each</p>
            <p class="cart-stock-message${availabilityError || availableQuantity === null || availableQuantity === 0 ? " stock-error" : ""}">${escapeHtml(stockMessage)}</p>
            <div class="quantity-control" aria-label="Quantity for ${product.name}, size ${product.size}">
              <button type="button" data-action="decrease" data-id="${product.id}" data-size="${product.size}" aria-label="Decrease quantity">−</button>
              <span>${product.quantity}</span>
              <button type="button" data-action="increase" data-id="${product.id}" data-size="${product.size}" aria-label="Increase quantity" ${stockLimitReached || availabilityError ? "disabled" : ""}>+</button>
            </div>
            <p class="cart-stock-warning" ${warning ? "" : "hidden"}>${warning}</p>
          </div>
          <div class="cart-item-total-area">
            <p class="cart-item-total">${formatPrice(product.price * product.quantity)}</p>
            <button class="remove-item" type="button" data-action="remove" data-id="${product.id}" data-size="${product.size}">Remove</button>
          </div>
        </article>
      `;
    }).join("");

    const subtotal = productsInCart.reduce((total, product) => total + product.price * product.quantity, 0);
    subtotalElement.textContent = formatPrice(subtotal);
    checkoutButton.disabled = productsInCart.length === 0 || !canProceedToCheckout;
  }

  refreshCart = renderCart;

  cartList.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) {
      return;
    }

    if (button.dataset.action === "remove") {
      const cartItems = readCart();
      saveCart(cartItems.filter((item) =>
        item.id !== button.dataset.id || item.size !== button.dataset.size
      ));
      renderCart();
      return;
    }

    const cartItems = readCart();
    const selectedItem = cartItems.find((item) =>
      item.id === button.dataset.id && item.size === button.dataset.size
    );
    if (!selectedItem) {
      return;
    }

    const selectedProduct = products.find((product) => product.id === selectedItem.id);
    if (button.dataset.action === "increase") {
      button.disabled = true;
      let availability;
      try {
        availability = await fetchProductAvailability(selectedProduct.id);
      } catch {
        renderCart();
        return;
      }
      const availableQuantity = getSizeStock(availability, selectedItem.size);
      if (availableQuantity === null ||
          getRemainingStock(cartItems, selectedProduct.id, selectedItem.size, availableQuantity) === 0) {
        renderCart();
        return;
      }
      selectedItem.quantity += 1;
    } else if (button.dataset.action === "decrease") {
      selectedItem.quantity = Math.max(1, selectedItem.quantity - 1);
    } else {
      return;
    }

    saveCart(cartItems);
    renderCart();
  });

  renderCart();
}

const checkoutForm = document.querySelector("#checkout-form");

if (checkoutForm) {
  const summaryList = document.querySelector("#checkout-items");
  const summaryTotal = document.querySelector("#checkout-total");
  const checkoutLayout = document.querySelector("#checkout-layout");
  const checkoutEmpty = document.querySelector("#checkout-empty");
  const checkoutMessage = document.querySelector("#checkout-message");
  const submitButton = document.querySelector("#place-order-button");
  const checkoutSubmitLabel = submitButton.textContent;
  let isSubmittingOrder = false;

  function getCheckoutItems(cartItems = readCart()) {
    return cartItems
      .map((item) => {
        const product = products.find((currentProduct) => currentProduct.id === item.id);
        return product ? { ...item, product } : null;
      })
      .filter(Boolean);
  }

  function renderCheckoutSummary() {
    const items = getCheckoutItems();
    checkoutEmpty.hidden = items.length > 0;
    checkoutLayout.hidden = items.length === 0;
    submitButton.disabled = items.length === 0 || isSubmittingOrder;

    summaryList.innerHTML = items.map(({ product, size, quantity }) => `
      <article class="checkout-item">
        <img class="checkout-item-image" src="${product.image}" alt="${product.imageAlt}">
        <div class="checkout-item-info">
          <h3>${product.name}</h3>
          <p>Size: ${size === "Free size" ? "Free Size" : size}</p>
          <p>Quantity: ${quantity}</p>
          <p>${formatPrice(product.price)} each</p>
        </div>
        <strong class="checkout-item-total">${formatPrice(product.price * quantity)}</strong>
      </article>
    `).join("");

    const estimate = items.reduce((total, { product, quantity }) => total + product.price * quantity, 0);
    summaryTotal.textContent = formatPrice(estimate);
  }

  function createCheckoutPayload(form, cartItems) {
    const formData = new FormData(form);
    return {
      customer: {
        name: String(formData.get("name")).trim(),
        phone: String(formData.get("phone")).trim(),
        email: String(formData.get("email")).trim(),
        address: String(formData.get("address")).trim(),
        city: String(formData.get("city")).trim(),
        pincode: String(formData.get("pincode")).trim()
      },
      items: getCheckoutItems(cartItems).map(({ id, size, quantity }) => ({
        productId: id,
        size: size === "Free size" ? "Free Size" : size,
        quantity
      }))
    };
  }

  function canonicalizeCheckoutPayload(payload) {
    const groupedItems = new Map();
    for (const item of payload.items) {
      const key = `${item.productId}\u0000${item.size}`;
      groupedItems.set(key, (groupedItems.get(key) || 0) + item.quantity);
    }

    const items = [...groupedItems.entries()]
      .map(([key, quantity]) => {
        const splitAt = key.indexOf("\u0000");
        return {
          productId: key.slice(0, splitAt),
          size: key.slice(splitAt + 1),
          quantity
        };
      })
      .sort((left, right) =>
        (left.productId < right.productId ? -1 : left.productId > right.productId ? 1 : 0) ||
        (left.size < right.size ? -1 : left.size > right.size ? 1 : 0)
      );
    const customer = {
      ...payload.customer,
      phone: payload.customer.phone.replace(/[\s-]/g, "").replace(/^\+91/, ""),
      email: payload.customer.email.toLowerCase() || null
    };
    return JSON.stringify({ version: 1, paymentMethod: "COD", customer, items });
  }

  async function fingerprintCheckoutPayload(payload) {
    if (!window.crypto?.subtle) {
      throw new Error("Secure checkout is unavailable in this browser. Please use a modern browser.");
    }
    const encoded = new TextEncoder().encode(canonicalizeCheckoutPayload(payload));
    const digest = await window.crypto.subtle.digest("SHA-256", encoded);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function generateIdempotencyKey() {
    if (window.crypto.randomUUID) {
      return window.crypto.randomUUID();
    }
    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  async function getCheckoutIdempotencyKey(payload) {
    const fingerprint = await fingerprintCheckoutPayload(payload);
    let previousAttempt;
    try {
      previousAttempt = JSON.parse(localStorage.getItem(checkoutAttemptStorageKey) || "null");
    } catch (error) {
      console.error("Could not read the saved checkout attempt.", error);
    }

    if (previousAttempt?.fingerprint === fingerprint &&
        /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(previousAttempt.key || "")) {
      return previousAttempt.key;
    }

    const key = generateIdempotencyKey();
    try {
      localStorage.setItem(checkoutAttemptStorageKey, JSON.stringify({ key, fingerprint }));
    } catch {
      throw new Error("Your browser could not save a secure retry token. Check browser storage and try again.");
    }
    return key;
  }

  renderCheckoutSummary();

  checkoutForm.addEventListener("input", () => {
    checkoutMessage.textContent = "";
  });

  checkoutForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (isSubmittingOrder || !checkoutForm.reportValidity()) {
      return;
    }

    const cartItems = readCart();
    if (cartItems.length === 0) {
      renderCheckoutSummary();
      checkoutMessage.textContent = "Your cart is empty. Add an item before placing an order.";
      return;
    }

    isSubmittingOrder = true;
    submitButton.disabled = true;
    submitButton.textContent = "Placing your order…";
    checkoutMessage.textContent = "Please wait while we securely place your order.";

    try {
      const payload = createCheckoutPayload(checkoutForm, cartItems);
      const idempotencyKey = await getCheckoutIdempotencyKey(payload);
      const response = await fetch(`${API_BASE_URL}/api/orders`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey
        },
        body: JSON.stringify(payload)
      });

      let result;
      try {
        result = await response.json();
      } catch {
        throw new Error("The server returned an unreadable response. Your cart is unchanged; you can safely retry.");
      }

      if (response.status !== 201 || result.success !== true ||
          typeof result.orderNumber !== "string" ||
          !Number.isFinite(result.totalAmount) ||
          result.paymentMethod !== "COD" ||
          result.paymentStatus !== "Pending" ||
          result.orderStatus !== "Order Placed") {
        throw new Error(result.message || "We could not place the order. Your cart is unchanged.");
      }

      try {
        sessionStorage.setItem(confirmationStorageKey, JSON.stringify({
          orderNumber: result.orderNumber,
          totalAmount: result.totalAmount,
          paymentMethod: result.paymentMethod,
          paymentStatus: result.paymentStatus,
          orderStatus: result.orderStatus,
          confirmedAt: Date.now()
        }));
      } catch {
        checkoutMessage.textContent = `Your order was accepted (${result.orderNumber}), but this browser could not open the confirmation page. Keep this order number and retry safely if needed.`;
        return;
      }

      localStorage.removeItem("dazzleCart");
      localStorage.removeItem(checkoutAttemptStorageKey);
      window.location.assign("order-confirmation.html");
    } catch (error) {
      checkoutMessage.textContent = error instanceof TypeError
        ? "Could not reach the order service. Check that the backend is running, then retry; your cart is unchanged."
        : error.message;
    } finally {
      isSubmittingOrder = false;
      submitButton.disabled = readCart().length === 0;
      submitButton.textContent = checkoutSubmitLabel;
    }
  });
}

const checkoutButton = document.querySelector("#checkout-button");
if (checkoutButton) {
  checkoutButton.addEventListener("click", () => {
    if (!checkoutButton.disabled) {
      window.location.assign("checkout.html");
    }
  });
}

const confirmationPage = document.querySelector("#order-confirmation");
if (confirmationPage) {
  const confirmationUnavailable = document.querySelector("#confirmation-unavailable");
  const confirmationDetails = document.querySelector("#confirmation-details");
  let confirmation;

  try {
    confirmation = JSON.parse(sessionStorage.getItem(confirmationStorageKey) || "null");
  } catch {
    confirmation = null;
  }

  if (confirmation &&
      typeof confirmation.orderNumber === "string" &&
      Number.isFinite(confirmation.totalAmount) &&
      confirmation.paymentMethod === "COD" &&
      confirmation.paymentStatus === "Pending" &&
      confirmation.orderStatus === "Order Placed" &&
      Number.isFinite(confirmation.confirmedAt) &&
      confirmation.confirmedAt <= Date.now()) {
    document.querySelector("#confirmed-order-number").textContent = confirmation.orderNumber;
    document.querySelector("#confirmed-order-total").textContent = formatPrice(confirmation.totalAmount);
    document.querySelector("#confirmed-payment-method").textContent = "Cash on Delivery";
    document.querySelector("#confirmed-payment-status").textContent = confirmation.paymentStatus;
    document.querySelector("#confirmed-order-status").textContent = confirmation.orderStatus;
    confirmationDetails.hidden = false;
  } else {
    confirmationUnavailable.hidden = false;
  }
}

const trackingForm = document.querySelector("#tracking-form");
if (trackingForm) {
  const trackingMessage = document.querySelector("#tracking-message");
  const trackingResults = document.querySelector("#tracking-results");
  const trackingSubmit = document.querySelector("#tracking-submit");
  const trackingSubmitLabel = trackingSubmit.textContent;
  const supportedOrderStatuses = [
    "Order Placed",
    "Confirmed",
    "Processing",
    "Ready for Dispatch",
    "Shipped",
    "Delivered",
    "Cancelled"
  ];

  function isValidTrackingOrder(order) {
    return order &&
      typeof order.orderNumber === "string" &&
      typeof order.orderDate === "string" &&
      Number.isFinite(Date.parse(order.orderDate)) &&
      Number.isFinite(order.totalAmount) &&
      typeof order.paymentMethod === "string" &&
      typeof order.paymentStatus === "string" &&
      supportedOrderStatuses.includes(order.orderStatus) &&
      Array.isArray(order.items) &&
      order.items.every((item) =>
        item &&
        typeof item.productName === "string" &&
        typeof item.size === "string" &&
        Number.isSafeInteger(item.quantity) &&
        item.quantity > 0
      );
  }

  function displayTrackedOrder(order) {
    document.querySelector("#tracking-result-number").textContent = order.orderNumber;
    document.querySelector("#tracking-result-date").textContent =
      new Date(order.orderDate).toLocaleString();
    document.querySelector("#tracking-result-total").textContent = formatPrice(order.totalAmount);
    document.querySelector("#tracking-result-payment-method").textContent = order.paymentMethod;
    document.querySelector("#tracking-result-payment-status").textContent = order.paymentStatus;
    document.querySelector("#tracking-result-order-status").textContent = order.orderStatus;

    const cancelled = order.orderStatus === "Cancelled";
    document.querySelector("#tracking-cancelled").hidden = !cancelled;
    const timeline = document.querySelector("#order-timeline");
    timeline.hidden = cancelled;
    if (!cancelled) {
      const currentIndex = supportedOrderStatuses.indexOf(order.orderStatus);
      timeline.querySelectorAll("li").forEach((step, index) => {
        step.classList.toggle("is-complete", index < currentIndex);
        step.classList.toggle("is-current", index === currentIndex);
        if (index === currentIndex) {
          step.setAttribute("aria-current", "step");
        } else {
          step.removeAttribute("aria-current");
        }
      });
    }

    const itemList = document.querySelector("#tracking-items");
    itemList.replaceChildren();
    for (const item of order.items) {
      const listItem = document.createElement("li");
      const name = document.createElement("strong");
      name.textContent = item.productName;
      const details = document.createElement("span");
      details.textContent = `Size: ${item.size} · Quantity: ${item.quantity}`;
      listItem.append(name, details);
      itemList.append(listItem);
    }
    trackingResults.hidden = false;
  }

  trackingForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!trackingForm.reportValidity()) return;

    trackingResults.hidden = true;
    trackingMessage.textContent = "Looking up your order securely…";
    trackingSubmit.disabled = true;
    trackingSubmit.textContent = "Searching…";

    try {
      const formData = new FormData(trackingForm);
      const response = await fetch(`${API_BASE_URL}/api/orders/track`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderNumber: String(formData.get("orderNumber")).trim(),
          phone: String(formData.get("phone")).trim()
        })
      });
      let result;
      try {
        result = await response.json();
      } catch {
        throw new Error("Unable to retrieve this order right now.");
      }

      if (!response.ok) {
        throw new Error(typeof result.message === "string"
          ? result.message
          : "The order number or phone number could not be verified.");
      }
      if (result.success !== true || !isValidTrackingOrder(result.order)) {
        throw new Error("Unable to retrieve this order right now.");
      }

      displayTrackedOrder(result.order);
      trackingMessage.textContent = "";
    } catch (error) {
      trackingMessage.textContent = error instanceof TypeError
        ? "Unable to connect to the order service. Please try again."
        : error.message;
    } finally {
      trackingSubmit.disabled = false;
      trackingSubmit.textContent = trackingSubmitLabel;
    }
  });
}

function showAccountMessage(element, message, isError = false) {
  if (!element) return;
  element.textContent = message;
  element.classList.toggle("form-message-error", isError);
  element.classList.toggle("form-message-success", !isError && Boolean(message));
}

for (const form of [
  document.querySelector("#account-login-form"),
  document.querySelector("#account-register-form")
]) {
  if (!form) continue;
  const message = document.querySelector("#account-form-message");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    showAccountMessage(message, "Please wait…");

    try {
      const formValues = Object.fromEntries(new FormData(form).entries());
      const endpoint = form.id === "account-register-form"
        ? "/api/account/register"
        : "/api/account/login";
      const result = await accountApiRequest(endpoint, {
        method: "POST",
        body: JSON.stringify(formValues)
      });
      setAccountMenu(result.customer);
      const returnTo = new URLSearchParams(window.location.search).get("returnTo");
      const start = new URLSearchParams(window.location.search).get("start");
      window.location.href = returnTo === "measurement-studio.html"
        ? `measurement-studio.html${start === "1" ? "?start=1" : ""}`
        : "my-account.html";
    } catch (error) {
      showAccountMessage(
        message,
        error instanceof TypeError
          ? "Unable to connect to the account service. Please try again."
          : error.message,
        true
      );
      submitButton.disabled = false;
    }
  });
}

const passwordResetRequestForm = document.querySelector("#password-reset-request-form");
if (passwordResetRequestForm) {
  const message = document.querySelector("#password-reset-request-message");
  passwordResetRequestForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!passwordResetRequestForm.reportValidity()) return;
    const submitButton = passwordResetRequestForm.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    showAccountMessage(message, "Please wait…");
    try {
      const email = new FormData(passwordResetRequestForm).get("email");
      const result = await accountApiRequest("/api/account/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email })
      });
      showAccountMessage(message, result.message);
    } catch (error) {
      showAccountMessage(message, error.message, true);
    } finally {
      submitButton.disabled = false;
    }
  });
}

const passwordResetForm = document.querySelector("#password-reset-form");
if (passwordResetForm) {
  const message = document.querySelector("#password-reset-message");
  const token = new URLSearchParams(window.location.hash.slice(1)).get("token");
  passwordResetForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!passwordResetForm.reportValidity()) return;
    const values = new FormData(passwordResetForm);
    if (!token) {
      showAccountMessage(message, "This reset link is invalid or has expired.", true);
      return;
    }
    if (values.get("password") !== values.get("confirmation")) {
      showAccountMessage(message, "The passwords do not match.", true);
      return;
    }
    const submitButton = passwordResetForm.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    showAccountMessage(message, "Please wait…");
    try {
      const result = await accountApiRequest("/api/account/reset-password", {
        method: "POST",
        body: JSON.stringify({ token, password: values.get("password") })
      });
      passwordResetForm.reset();
      showAccountMessage(message, result.message);
      window.setTimeout(() => {
        window.location.href = "account-login.html";
      }, 1800);
    } catch (error) {
      showAccountMessage(message, error.message, true);
      submitButton.disabled = false;
    }
  });
}

const accountPage = document.querySelector("#account-page");

if (accountPage) {
  const accountMessage = document.querySelector("#account-page-message");
  const profileForm = document.querySelector("#account-profile-form");
  const orderList = document.querySelector("#account-order-list");
  const orderDetails = document.querySelector("#account-order-details");

  function renderAccountOrderDetails(order) {
    orderDetails.replaceChildren();
    const heading = document.createElement("h3");
    heading.textContent = `Order ${order.orderNumber}`;
    const status = document.createElement("p");
    status.textContent = `Status: ${order.orderStatus} · Payment: ${order.paymentStatus}`;
    const items = document.createElement("ul");
    for (const item of order.items) {
      const line = document.createElement("li");
      line.textContent = `${item.productName} · Size ${item.size} · Quantity ${item.quantity}`;
      items.append(line);
    }
    orderDetails.append(heading, status, items);
    orderDetails.hidden = false;
  }

  async function loadAccountPage() {
    try {
      const { customer } = await accountApiRequest("/api/account/me");
      document.querySelector("#account-greeting").textContent = `Welcome, ${customer.name}`;
      profileForm.elements.name.value = customer.name;
      profileForm.elements.phone.value = customer.phone;
      profileForm.elements.email.value = customer.email;

      const ordersResult = await accountApiRequest("/api/account/orders");
      orderList.replaceChildren();
      if (ordersResult.orders.length === 0) {
        const empty = document.createElement("li");
        empty.textContent = "No orders have been placed from this account yet.";
        orderList.append(empty);
      }
      for (const order of ordersResult.orders) {
        const item = document.createElement("li");
        const summary = document.createElement("div");
        const number = document.createElement("strong");
        number.textContent = order.orderNumber;
        const details = document.createElement("span");
        details.textContent = `${order.orderStatus} · Payment: ${order.paymentStatus} · ${formatPrice(order.totalAmount)}`;
        summary.append(number, details);
        const showDetails = document.createElement("button");
        showDetails.type = "button";
        showDetails.className = "text-button";
        showDetails.textContent = "View details";
        showDetails.addEventListener("click", async () => {
          showDetails.disabled = true;
          try {
            const result = await accountApiRequest(`/api/account/orders/${order.orderId}`);
            renderAccountOrderDetails(result.order);
          } catch (error) {
            showAccountMessage(accountMessage, error.message, true);
          } finally {
            showDetails.disabled = false;
          }
        });
        item.append(summary, showDetails);
        orderList.append(item);
      }
      accountPage.hidden = false;
      showAccountMessage(accountMessage, "");
    } catch (error) {
      if (error.status === 401) {
        showAccountMessage(accountMessage, "Please sign in to view your account.");
        document.querySelector("#account-sign-in-links").hidden = false;
      } else {
        showAccountMessage(
          accountMessage,
          error instanceof TypeError
            ? "Unable to connect to the account service. Please refresh and try again."
            : error.message,
          true
        );
      }
    }
  }

  profileForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!profileForm.reportValidity()) return;
    const saveButton = profileForm.querySelector('button[type="submit"]');
    saveButton.disabled = true;
    try {
      const body = JSON.stringify(Object.fromEntries(new FormData(profileForm).entries()));
      const result = await accountApiRequest("/api/account/me", {
        method: "PATCH",
        body
      });
      document.querySelector("#account-greeting").textContent = `Welcome, ${result.customer.name}`;
      setAccountMenu(result.customer);
      showAccountMessage(accountMessage, "Your profile has been updated.");
    } catch (error) {
      showAccountMessage(accountMessage, error.message, true);
    } finally {
      saveButton.disabled = false;
    }
  });

  loadAccountPage();
}

window.addEventListener("storage", () => {
  updateCartCount();
  if (refreshProductStock) {
    refreshProductStock();
  }
  if (refreshCart) {
    refreshCart();
  }
});
