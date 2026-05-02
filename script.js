const SUPABASE_URL = "https://bgfbbuqhtszqcvwwxngy.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJnZmJidXFodHN6cWN2d3d4bmd5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc3MTI4NzYsImV4cCI6MjA5MzI4ODg3Nn0.T3THm95jYoA1fPakGAFzQ2KAz-S46pL227i9CVCmSmw";
const SESSION_KEY = "oficinaManagerSession";
// Coloque aqui seu numero de suporte, somente numeros. Exemplo: "5511999999999".
// Se ficar vazio, o botao usa o WhatsApp cadastrado na oficina.
const SUPPORT_WHATSAPP_NUMBER = "";
const SUPPORT_WHATSAPP_MESSAGE = "Olá, preciso de suporte no Oficina Manager.";

const db = window.supabase
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

let currentUser = getSession();
let currentWorkshop = null;
let workshopsCache = [];
let clientsCache = [];
let ordersCache = [];

document.addEventListener("DOMContentLoaded", () => {
  if (document.querySelector("#loginForm")) {
    setupLoginPage();
  }

  if (document.querySelector("#logoutBtn")) {
    setupDashboardPage();
  }
});

function setupLoginPage() {
  const loginForm = document.querySelector("#loginForm");
  const setupMasterForm = document.querySelector("#setupMasterForm");
  const message = document.querySelector("#loginMessage");
  const setupMessage = document.querySelector("#setupMessage");

  if (!db) {
    message.textContent = "Não foi possível carregar o Supabase. Verifique sua internet e abra a página novamente.";
    loginForm.querySelector("button").disabled = true;
    setupMasterForm.querySelector("button").disabled = true;
    return;
  }

  if (currentUser) {
    window.location.href = "dashboard.html";
    return;
  }

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    message.textContent = "Verificando acesso...";

    const email = document.querySelector("#loginEmail").value.trim();
    const senha = document.querySelector("#loginPassword").value.trim();

    const { data, error } = await db
      .from("usuarios")
      .select("id,email,tipo,oficina_id")
      .eq("email", email)
      .eq("senha", senha)
      .maybeSingle();

    if (error) {
      message.textContent = `Erro ao consultar usuários: ${error.message}`;
      return;
    }

    if (!data) {
      message.textContent = "Email ou senha inválidos. Se for o primeiro acesso, crie o admin mestre abaixo.";
      return;
    }

    saveSession(data);
    window.location.href = "dashboard.html";
  });

  setupMasterForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    setupMessage.textContent = "Criando admin mestre...";

    const email = document.querySelector("#setupMasterEmail").value.trim();
    const senha = document.querySelector("#setupMasterPassword").value.trim();

    const { data: existing, error: selectError } = await db
      .from("usuarios")
      .select("id,email,tipo,oficina_id")
      .eq("email", email)
      .maybeSingle();

    if (selectError) {
      setupMessage.textContent = makeFriendlyError("Erro ao verificar usuário", selectError);
      return;
    }

    if (existing) {
      setupMessage.textContent = "Este email já existe. Use-o no login acima ou escolha outro email.";
      return;
    }

    const { error: insertError } = await db.from("usuarios").insert({
      email,
      senha,
      tipo: "master",
      oficina_id: null
    });

    if (insertError) {
      setupMessage.textContent = makeFriendlyError("Erro ao criar admin", insertError);
      return;
    }

    setupMessage.textContent = "Admin criado. Agora entre usando o email e a senha cadastrados.";
    document.querySelector("#loginEmail").value = email;
    document.querySelector("#loginPassword").value = senha;
  });
}

async function setupDashboardPage() {
  if (!db) {
    showToast("Não foi possível carregar o Supabase. Verifique sua internet.");
    return;
  }

  if (!currentUser) {
    window.location.href = "index.html";
    return;
  }

  bindSharedEvents();

  if (currentUser.tipo === "master") {
    setupMasterPanel();
  } else {
    await setupWorkshopPanel();
  }
}

function bindSharedEvents() {
  document.querySelector("#logoutBtn").addEventListener("click", () => {
    localStorage.removeItem(SESSION_KEY);
    window.location.href = "index.html";
  });

  document.querySelectorAll(".tab-button").forEach((button) => {
    button.addEventListener("click", () => switchTab(button.dataset.tab));
  });
}

async function setupMasterPanel() {
  document.querySelector("#userTypeLabel").textContent = "Admin mestre";
  document.querySelector("#panelTitle").textContent = "Painel Mestre";
  document.querySelector("#workshopTabs").classList.add("hidden");
  hidePanels(["clients", "orders", "settings"]);
  switchTab("masterOverview");

  document.querySelector("#workshopForm").addEventListener("submit", saveWorkshop);
  document.querySelector("#clearWorkshopFormBtn").addEventListener("click", clearWorkshopForm);
  document.querySelector("#userForm").addEventListener("submit", createUser);
  document.querySelector("#userType").addEventListener("change", updateUserWorkshopRequirement);
  bindImagePicker("workshopLogoFile", "workshopLogoData", "workshopLogoPreview", "workshopLogo");

  await loadMasterData();
}

async function setupWorkshopPanel() {
  document.querySelector("#userTypeLabel").textContent = "Painel da oficina";
  document.querySelector("#masterTabs").classList.add("hidden");
  hidePanels(["masterOverview", "masterWorkshops", "masterUsers"]);
  switchTab("clients");

  document.querySelector("#clientForm").addEventListener("submit", createClient);
  document.querySelector("#clientSearch").addEventListener("input", renderClients);
  document.querySelector("#orderForm").addEventListener("submit", createOrder);
  document.querySelector("#statusFilter").addEventListener("change", renderOrders);
  document.querySelector("#settingsForm").addEventListener("submit", updateWorkshopSettings);
  bindImagePicker("settingsLogoFile", "settingsLogoData", "settingsLogoPreview", "settingsLogo");

  await loadWorkshopData();
}

function switchTab(tabId) {
  document.querySelectorAll(".tab-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tabId);
  });

  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === tabId);
  });
}

function hidePanels(ids) {
  ids.forEach((id) => document.querySelector(`#${id}`).classList.remove("active"));
}

async function loadMasterData() {
  const [oficinas, usuarios, clientes, ordens] = await Promise.all([
    db.from("oficinas").select("*").order("nome"),
    db.from("usuarios").select("id,email,tipo,oficina_id"),
    db.from("clientes").select("id,oficina_id"),
    db.from("ordens_servico").select("id,oficina_id,status,pagamento,valor")
  ]);

  if (oficinas.error || usuarios.error || clientes.error || ordens.error) {
    showToast("Erro ao carregar dados do painel mestre.");
    return;
  }

  workshopsCache = oficinas.data || [];
  renderMasterStats(workshopsCache, usuarios.data || [], clientes.data || [], ordens.data || []);
  renderWorkshops();
  renderWorkshopOptions();
  renderUsers(usuarios.data || []);
}

function renderMasterStats(oficinas, usuarios, clientes, ordens) {
  const totalValue = ordens.reduce((sum, order) => sum + Number(order.valor || 0), 0);
  const finalizadas = ordens.filter((order) => order.status === "finalizado").length;

  document.querySelector("#masterStats").innerHTML = `
    <article class="stat-card"><p class="muted">Oficinas</p><div class="stat-number">${oficinas.length}</div></article>
    <article class="stat-card"><p class="muted">Usuários</p><div class="stat-number">${usuarios.length}</div></article>
    <article class="stat-card"><p class="muted">Clientes</p><div class="stat-number">${clientes.length}</div></article>
    <article class="stat-card"><p class="muted">OS finalizadas</p><div class="stat-number">${finalizadas}</div></article>
    <article class="stat-card full-row"><p class="muted">Valor total em ordens</p><div class="stat-number">${formatMoney(totalValue)}</div></article>
  `;
}

async function saveWorkshop(event) {
  event.preventDefault();

  const id = document.querySelector("#workshopId").value;
  const payload = {
    nome: document.querySelector("#workshopName").value.trim(),
    logo: getImageValue("workshopLogoData", "workshopLogo"),
    cor: document.querySelector("#workshopColor").value,
    whatsapp: document.querySelector("#workshopWhatsapp").value.trim() || null
  };

  const result = id
    ? await db.from("oficinas").update(payload).eq("id", id)
    : await db.from("oficinas").insert(payload);

  if (result.error) {
    showToast("Não foi possível salvar a oficina.");
    return;
  }

  clearWorkshopForm();
  showToast(id ? "Oficina atualizada." : "Oficina criada.");
  await loadMasterData();
}

function renderWorkshops() {
  const list = document.querySelector("#workshopsList");

  if (!workshopsCache.length) {
    list.innerHTML = `<div class="empty">Nenhuma oficina cadastrada.</div>`;
    return;
  }

  list.innerHTML = workshopsCache.map((oficina) => `
    <article class="item">
      <div class="item-header">
        ${oficina.logo ? `<img class="item-photo" src="${escapeHtml(oficina.logo)}" alt="Logo de ${escapeHtml(oficina.nome)}">` : ""}
        <div>
          <div class="item-title">${escapeHtml(oficina.nome)}</div>
          <div class="item-subtitle">WhatsApp: ${escapeHtml(oficina.whatsapp || "não informado")}</div>
        </div>
        <span class="badge" style="border: 2px solid ${escapeHtml(oficina.cor || "#146c43")}">${escapeHtml(oficina.cor || "#146c43")}</span>
      </div>
      <div class="item-actions">
        <button class="ghost-button" type="button" onclick="editWorkshop('${oficina.id}')">Editar</button>
      </div>
    </article>
  `).join("");
}

function editWorkshop(id) {
  const oficina = workshopsCache.find((item) => String(item.id) === String(id));

  if (!oficina) {
    return;
  }

  document.querySelector("#workshopId").value = oficina.id;
  document.querySelector("#workshopName").value = oficina.nome || "";
  document.querySelector("#workshopLogo").value = oficina.logo && !oficina.logo.startsWith("data:") ? oficina.logo : "";
  document.querySelector("#workshopLogoData").value = oficina.logo && oficina.logo.startsWith("data:") ? oficina.logo : "";
  updateImagePreview("workshopLogoPreview", oficina.logo);
  document.querySelector("#workshopColor").value = oficina.cor || "#146c43";
  document.querySelector("#workshopWhatsapp").value = oficina.whatsapp || "";
  switchTab("masterWorkshops");
}

function clearWorkshopForm() {
  document.querySelector("#workshopForm").reset();
  document.querySelector("#workshopId").value = "";
  document.querySelector("#workshopLogoData").value = "";
  document.querySelector("#workshopColor").value = "#146c43";
  updateImagePreview("workshopLogoPreview", "");
}

function renderWorkshopOptions() {
  const options = [`<option value="">Sem oficina</option>`]
    .concat(workshopsCache.map((oficina) => `<option value="${oficina.id}">${escapeHtml(oficina.nome)}</option>`))
    .join("");

  document.querySelector("#userWorkshop").innerHTML = options;
}

function updateUserWorkshopRequirement() {
  const isMaster = document.querySelector("#userType").value === "master";
  document.querySelector("#userWorkshop").required = !isMaster;
}

async function createUser(event) {
  event.preventDefault();

  const tipo = document.querySelector("#userType").value;
  const oficinaId = document.querySelector("#userWorkshop").value || null;

  if (tipo !== "master" && !oficinaId) {
    showToast("Selecione uma oficina para o usuário cliente.");
    return;
  }

  const payload = {
    email: document.querySelector("#userEmail").value.trim(),
    senha: document.querySelector("#userPassword").value.trim(),
    tipo,
    oficina_id: tipo === "master" ? null : oficinaId
  };

  const { error } = await db.from("usuarios").insert(payload);

  if (error) {
    showToast("Não foi possível criar o usuário.");
    return;
  }

  document.querySelector("#userForm").reset();
  updateUserWorkshopRequirement();
  showToast("Usuário criado.");
  await loadMasterData();
}

function renderUsers(users) {
  const list = document.querySelector("#usersList");

  if (!users.length) {
    list.innerHTML = `<div class="empty">Nenhum usuário cadastrado.</div>`;
    return;
  }

  list.innerHTML = users.map((user) => {
    const oficina = workshopsCache.find((item) => String(item.id) === String(user.oficina_id));
    return `
      <article class="item">
        <div class="item-header">
          <div>
            <div class="item-title">${escapeHtml(user.email)}</div>
            <div class="item-subtitle">${user.tipo === "master" ? "Admin mestre" : escapeHtml(oficina ? oficina.nome : "Oficina não encontrada")}</div>
          </div>
          <span class="badge">${escapeHtml(user.tipo)}</span>
        </div>
      </article>
    `;
  }).join("");
}

async function loadWorkshopData() {
  const oficinaId = currentUser.oficina_id;

  const [oficina, clientes, ordens] = await Promise.all([
    db.from("oficinas").select("*").eq("id", oficinaId).maybeSingle(),
    db.from("clientes").select("*").eq("oficina_id", oficinaId).order("nome"),
    db.from("ordens_servico").select("*").eq("oficina_id", oficinaId).order("id", { ascending: false })
  ]);

  if (oficina.error || clientes.error || ordens.error || !oficina.data) {
    showToast("Erro ao carregar dados da oficina.");
    return;
  }

  currentWorkshop = oficina.data;
  clientsCache = clientes.data || [];
  ordersCache = ordens.data || [];

  applyWorkshopTheme();
  setupSupportButton();
  fillSettingsForm();
  renderClients();
  renderClientOptions();
  renderOrders();
}

function applyWorkshopTheme() {
  const color = currentWorkshop.cor || "#146c43";
  document.documentElement.style.setProperty("--primary", color);
  document.documentElement.style.setProperty("--primary-dark", darkenHex(color));
  document.querySelector("#panelTitle").textContent = currentWorkshop.nome || "Painel da Oficina";

  const logo = document.querySelector("#headerLogo");
  if (currentWorkshop.logo) {
    logo.src = currentWorkshop.logo;
    logo.classList.add("visible");
  } else {
    logo.removeAttribute("src");
    logo.classList.remove("visible");
  }
}

function fillSettingsForm() {
  document.querySelector("#settingsName").value = currentWorkshop.nome || "";
  document.querySelector("#settingsColor").value = currentWorkshop.cor || "#146c43";
  document.querySelector("#settingsWhatsapp").value = currentWorkshop.whatsapp || "";
  document.querySelector("#settingsLogo").value = currentWorkshop.logo && !currentWorkshop.logo.startsWith("data:") ? currentWorkshop.logo : "";
  document.querySelector("#settingsLogoData").value = currentWorkshop.logo && currentWorkshop.logo.startsWith("data:") ? currentWorkshop.logo : "";
  updateImagePreview("settingsLogoPreview", currentWorkshop.logo);
}

async function createClient(event) {
  event.preventDefault();

  const payload = {
    nome: document.querySelector("#clientName").value.trim(),
    telefone: document.querySelector("#clientPhone").value.trim(),
    carro: document.querySelector("#clientCar").value.trim(),
    placa: document.querySelector("#clientPlate").value.trim().toUpperCase(),
    oficina_id: currentUser.oficina_id
  };

  const { error } = await db.from("clientes").insert(payload);

  if (error) {
    showToast("Não foi possível salvar o cliente.");
    return;
  }

  document.querySelector("#clientForm").reset();
  showToast("Cliente salvo.");
  await loadWorkshopData();
}

function renderClients() {
  const search = document.querySelector("#clientSearch").value.trim().toLowerCase();
  const list = document.querySelector("#clientsList");
  const clients = clientsCache.filter((client) => {
    const text = `${client.nome} ${client.telefone} ${client.carro} ${client.placa}`.toLowerCase();
    return text.includes(search);
  });

  if (!clients.length) {
    list.innerHTML = `<div class="empty">Nenhum cliente encontrado.</div>`;
    return;
  }

  list.innerHTML = clients.map((client) => `
    <article class="item">
      <div class="item-header">
        <div>
          <div class="item-title">${escapeHtml(client.nome)}</div>
          <div class="item-subtitle">${escapeHtml(client.carro)} - ${escapeHtml(client.placa)}</div>
        </div>
        <span class="badge">${escapeHtml(client.telefone)}</span>
      </div>
    </article>
  `).join("");
}

function renderClientOptions() {
  const select = document.querySelector("#orderClient");

  if (!clientsCache.length) {
    select.innerHTML = `<option value="">Cadastre um cliente primeiro</option>`;
    return;
  }

  select.innerHTML = `<option value="">Selecione um cliente</option>` + clientsCache.map((client) => (
    `<option value="${client.id}">${escapeHtml(client.nome)} - ${escapeHtml(client.carro)} (${escapeHtml(client.placa)})</option>`
  )).join("");
}

async function createOrder(event) {
  event.preventDefault();

  const payload = {
    cliente_id: document.querySelector("#orderClient").value,
    problema: document.querySelector("#orderProblem").value.trim(),
    servico: document.querySelector("#orderService").value.trim(),
    valor: Number(document.querySelector("#orderValue").value),
    status: document.querySelector("#orderStatus").value,
    pagamento: document.querySelector("#orderPayment").value,
    oficina_id: currentUser.oficina_id
  };

  const { error } = await db.from("ordens_servico").insert(payload);

  if (error) {
    showToast("Não foi possível salvar a ordem.");
    return;
  }

  document.querySelector("#orderForm").reset();
  showToast("Ordem salva.");
  await loadWorkshopData();
}

function renderOrders() {
  const filter = document.querySelector("#statusFilter").value;
  const list = document.querySelector("#ordersList");
  const orders = ordersCache.filter((order) => filter === "todos" || order.status === filter);

  if (!orders.length) {
    list.innerHTML = `<div class="empty">Nenhuma ordem de serviço encontrada.</div>`;
    return;
  }

  list.innerHTML = orders.map((order) => {
    const client = clientsCache.find((item) => String(item.id) === String(order.cliente_id));
    const statusClass = order.status === "finalizado" ? "done" : order.status === "aguardando peça" ? "waiting" : "pending";
    const whatsapp = buildWhatsAppUrl(client ? client.telefone : "", "Seu veículo está pronto!");

    return `
      <article class="item ${statusClass}">
        <div class="item-header">
          <div>
            <div class="item-title">${escapeHtml(client ? client.nome : "Cliente não encontrado")}</div>
            <div class="item-subtitle">${escapeHtml(client ? `${client.carro} - ${client.placa}` : "Sem veículo")}</div>
          </div>
          <span class="badge">${formatMoney(order.valor || 0)}</span>
        </div>
        <div class="badges">
          <span class="badge">${labelStatus(order.status)}</span>
          <span class="badge ${escapeHtml(order.pagamento)}">${labelPayment(order.pagamento)}</span>
        </div>
        <div class="item-detail"><strong>Problema:</strong> ${escapeHtml(order.problema)}</div>
        <div class="item-detail"><strong>Serviço:</strong> ${escapeHtml(order.servico)}</div>
        <a class="whatsapp-button" href="${whatsapp}" target="_blank" rel="noopener">Abrir WhatsApp</a>
      </article>
    `;
  }).join("");
}

async function updateWorkshopSettings(event) {
  event.preventDefault();

  const payload = {
    nome: document.querySelector("#settingsName").value.trim(),
    cor: document.querySelector("#settingsColor").value,
    whatsapp: document.querySelector("#settingsWhatsapp").value.trim() || null,
    logo: getImageValue("settingsLogoData", "settingsLogo")
  };

  const { error } = await db.from("oficinas").update(payload).eq("id", currentUser.oficina_id);

  if (error) {
    showToast("Não foi possível salvar as configurações.");
    return;
  }

  showToast("Configurações salvas.");
  await loadWorkshopData();
}

function getSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY));
  } catch (error) {
    return null;
  }
}

function saveSession(user) {
  currentUser = user;
  localStorage.setItem(SESSION_KEY, JSON.stringify(user));
}

function buildWhatsAppUrl(phone, message) {
  const cleanPhone = String(phone || "").replace(/\D/g, "");
  const text = encodeURIComponent(message);

  if (!cleanPhone) {
    return `https://wa.me/?text=${text}`;
  }

  return `https://wa.me/55${cleanPhone}?text=${text}`;
}

function setupSupportButton() {
  const button = document.querySelector("#supportWhatsapp");
  const supportNumber = SUPPORT_WHATSAPP_NUMBER || currentWorkshop.whatsapp;

  if (!button || !supportNumber) {
    return;
  }

  button.href = buildWhatsAppUrl(supportNumber, SUPPORT_WHATSAPP_MESSAGE);
  button.classList.add("visible");
}

function labelStatus(status) {
  const labels = {
    "em andamento": "Em andamento",
    "aguardando peça": "Aguardando peça",
    "finalizado": "Finalizado"
  };

  return labels[status] || status;
}

function labelPayment(payment) {
  const labels = {
    pago: "Pago",
    fiado: "Fiado",
    parcial: "Parcial"
  };

  return labels[payment] || payment;
}

function formatMoney(value) {
  return Number(value).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function darkenHex(hex) {
  const safeHex = /^#[0-9a-f]{6}$/i.test(hex) ? hex : "#146c43";
  const number = parseInt(safeHex.slice(1), 16);
  const r = Math.max(0, ((number >> 16) & 255) - 35);
  const g = Math.max(0, ((number >> 8) & 255) - 35);
  const b = Math.max(0, (number & 255) - 35);

  return `#${[r, g, b].map((part) => part.toString(16).padStart(2, "0")).join("")}`;
}

function showToast(message) {
  const toast = document.querySelector("#toast");

  if (!toast) {
    return;
  }

  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 2400);
}

function bindImagePicker(fileInputId, dataInputId, previewId, urlInputId) {
  const fileInput = document.querySelector(`#${fileInputId}`);
  const urlInput = document.querySelector(`#${urlInputId}`);

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];

    if (!file) {
      return;
    }

    try {
      const imageData = await resizeImage(file, 600, 0.82);
      document.querySelector(`#${dataInputId}`).value = imageData;
      urlInput.value = "";
      updateImagePreview(previewId, imageData);
      showToast("Foto carregada.");
    } catch (error) {
      showToast("Não foi possível carregar a foto.");
    }
  });

  urlInput.addEventListener("input", () => {
    document.querySelector(`#${dataInputId}`).value = "";
    updateImagePreview(previewId, urlInput.value.trim());
  });
}

function getImageValue(dataInputId, urlInputId) {
  return document.querySelector(`#${dataInputId}`).value || document.querySelector(`#${urlInputId}`).value.trim() || null;
}

function updateImagePreview(previewId, source) {
  const preview = document.querySelector(`#${previewId}`);

  if (!preview) {
    return;
  }

  preview.innerHTML = source ? `<img src="${escapeHtml(source)}" alt="Prévia da logo">` : "Sem foto selecionada";
}

function resizeImage(file, maxSize, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      const image = new Image();

      image.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(image.width * scale);
        canvas.height = Math.round(image.height * scale);

        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };

      image.onerror = reject;
      image.src = reader.result;
    };

    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function makeFriendlyError(prefix, error) {
  if (error && error.message && error.message.toLowerCase().includes("row-level security")) {
    return `${prefix}: o Supabase bloqueou por RLS. Execute o arquivo supabase_setup.sql no SQL Editor do Supabase.`;
  }

  return `${prefix}: ${error.message}`;
}
