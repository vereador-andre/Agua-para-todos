import {
  auth,
  db,
  storage,
  firebaseConfig
} from "./firebase-config.js";

import {
  initializeApp
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";

import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  createUserWithEmailAndPassword,
  signOut as signOutSecondary,
  deleteUser
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  limit,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

import {
  ref,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-storage.js";

/* =========================================================
   ESTADO
========================================================= */

const $ = id => document.getElementById(id);

const state = {
  user: null,
  profile: null,
  households: [],
  deliveries: [],
  drivers: [],
  users: []
};

/* =========================================================
   FIREBASE SECUNDÁRIO
========================================================= */

let secondaryApp = null;
let secondaryAuth = null;

try {
  secondaryApp = initializeApp(
    firebaseConfig,
    "DriverRegistrationApp"
  );

  secondaryAuth = getAuth(secondaryApp);
} catch (error) {
  console.error("Erro ao inicializar Firebase secundário:", error);
}

/* =========================================================
   ACESSO POR TELEFONE DO BENEFICIÁRIO
========================================================= */

function normalizePhone(value) {
  let digits = String(value || "").replace(/\D/g, "");

  if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) {
    digits = digits.slice(2);
  }

  return digits;
}

function recipientAuthEmail(phone) {
  const digits = normalizePhone(phone);

  if (digits.length < 10 || digits.length > 11) {
    throw new Error("Informe um telefone brasileiro válido com DDD (10 ou 11 dígitos).");
  }

  return `beneficiario.${digits}@agua-para-todos.app`;
}

function loginIdentifierToEmail(identifier) {
  const value = String(identifier || "").trim();

  if (value.includes("@")) {
    return value.toLowerCase();
  }

  return recipientAuthEmail(value);
}

if ($("loginEmail")) {
  $("loginEmail").type = "text";
  $("loginEmail").inputMode = "email";
  $("loginEmail").autocomplete = "username";
  $("loginEmail").placeholder = "Ex: 84999998888 ou seu@email.com";
}

/* =========================================================
   CACHE OFFLINE
========================================================= */

const OFFLINE_DB_NAME = "agua-para-todos-offline";
const OFFLINE_DB_VERSION = 1;
const DELIVERY_CACHE_STORE = "deliveryCache";

function openOfflineDB() {
  return new Promise((resolve, reject) => {
    try {
      const request = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);

      request.onupgradeneeded = () => {
        const localDb = request.result;
        if (!localDb.objectStoreNames.contains(DELIVERY_CACHE_STORE)) {
          localDb.createObjectStore(DELIVERY_CACHE_STORE, { keyPath: "id" });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    } catch (error) {
      reject(error);
    }
  });
}

function prepareDeliveryForCache(delivery) {
  const local = { ...delivery };

  [
    "createdAt",
    "completedAt",
    "updatedAt",
    "recipientConfirmedAt"
  ].forEach(field => {
    if (local[field] && typeof local[field].toDate === "function") {
      local[field] = local[field].toDate().toISOString();
    }
  });

  return local;
}

async function saveDriverDeliveriesToCache(deliveries) {
  try {
    const localDb = await openOfflineDB();

    await new Promise((resolve, reject) => {
      const tx = localDb.transaction(DELIVERY_CACHE_STORE, "readwrite");
      const store = tx.objectStore(DELIVERY_CACHE_STORE);

      deliveries.forEach(delivery => {
        store.put(prepareDeliveryForCache(delivery));
      });

      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });

    localDb.close();
  } catch (error) {
    console.error("Erro ao salvar entregas no cache offline:", error);
  }
}

async function getCachedDriverDeliveries(driverUid) {
  try {
    const localDb = await openOfflineDB();

    const result = await new Promise((resolve, reject) => {
      const tx = localDb.transaction(DELIVERY_CACHE_STORE, "readonly");
      const request = tx.objectStore(DELIVERY_CACHE_STORE).getAll();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    localDb.close();

    return result
      .filter(delivery => delivery.driverUid === driverUid)
      .sort((a, b) =>
        String(a.scheduledDate || "").localeCompare(String(b.scheduledDate || ""))
      );
  } catch (error) {
    console.error("Erro ao carregar entregas do cache offline:", error);
    return [];
  }
}

/* =========================================================
   PERFIL OFFLINE
========================================================= */

function saveProfileToCache(userUid, profile) {
  try {
    localStorage.setItem(`aguaParaTodosProfile_${userUid}`, JSON.stringify(profile));
  } catch (error) {
    console.error("Erro ao salvar perfil local:", error);
  }
}

function getProfileFromCache(userUid) {
  try {
    const saved = localStorage.getItem(`aguaParaTodosProfile_${userUid}`);
    return saved ? JSON.parse(saved) : null;
  } catch (error) {
    console.error("Erro ao recuperar perfil local:", error);
    return null;
  }
}

/* =========================================================
   CONEXÃO
========================================================= */

function updateConnectionStatus() {
  const el = $("connectionStatus");
  if (!el) return;

  if (navigator.onLine) {
    el.textContent = "Online";
    el.classList.add("ok");
  } else {
    el.textContent = "Sem internet";
    el.classList.remove("ok");
  }
}

window.addEventListener("online", updateConnectionStatus);
window.addEventListener("offline", updateConnectionStatus);
updateConnectionStatus();

/* =========================================================
   EVENTOS PRINCIPAIS
========================================================= */

if ($("logoutBtn")) {
  $("logoutBtn").onclick = () => signOut(auth);
}

if ($("closeModal")) {
  $("closeModal").onclick = closeModal;
}

if ($("modal")) {
  $("modal").onclick = event => {
    if (event.target.id === "modal") closeModal();
  };
}

/* =========================================================
   FUNÇÕES GERAIS
========================================================= */

function toast(message) {
  if (!$("toast")) return;

  $("toast").textContent = message;
  $("toast").classList.add("show");

  setTimeout(() => {
    $("toast").classList.remove("show");
  }, 3500);
}

function openModal(html) {
  $("modalContent").innerHTML = html;
  $("modal").classList.remove("hidden");
}

function closeModal() {
  if ($("modal")) $("modal").classList.add("hidden");
  if ($("modalContent")) $("modalContent").innerHTML = "";
}

function esc(value = "") {
  return String(value).replace(
    /[&<>"']/g,
    character => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    })[character]
  );
}

function fmtDate(timestamp) {
  if (!timestamp) return "—";

  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return date.toLocaleString("pt-BR");
}

function dateOnly(value) {
  if (!value) return "—";
  return new Date(value + "T12:00:00").toLocaleDateString("pt-BR");
}

function generateConfirmationPin() {
  const values = new Uint32Array(1);

  if (window.crypto && window.crypto.getRandomValues) {
    window.crypto.getRandomValues(values);
    return String(values[0] % 1000000).padStart(6, "0");
  }

  return String(Math.floor(Math.random() * 1000000)).padStart(6, "0");
}

/* =========================================================
   LOGIN
========================================================= */

if ($("loginForm")) {
  $("loginForm").onsubmit = async event => {
    event.preventDefault();

    $("loginMsg").textContent = "";

    try {
      const identifier = $("loginEmail").value.trim();
      const email = loginIdentifierToEmail(identifier);

      await signInWithEmailAndPassword(
        auth,
        email,
        $("loginPassword").value
      );
    } catch (error) {
      console.error("Erro no login:", error);

      if ($("loginMsg")) {
        $("loginMsg").textContent =
          error.message && error.message.includes("telefone brasileiro válido")
            ? error.message
            : friendlyAuthError(error);
      }
    }
  };
}

function friendlyAuthError(error) {
  const messages = {
    "auth/invalid-credential": "Telefone/e-mail ou senha incorretos.",
    "auth/user-not-found": "Usuário não encontrado.",
    "auth/wrong-password": "Senha incorreta.",
    "auth/too-many-requests": "Muitas tentativas. Aguarde alguns minutos.",
    "auth/email-already-in-use": "Este acesso já está cadastrado.",
    "auth/invalid-email": "O telefone ou e-mail informado é inválido.",
    "auth/weak-password": "A senha informada é muito fraca.",
    "auth/network-request-failed": "Falha de conexão. Verifique sua internet."
  };

  return messages[error.code] || "Não foi possível entrar. Verifique seus dados.";
}

/* =========================================================
   AUTENTICAÇÃO E CARREGAMENTO DO PERFIL
========================================================= */

onAuthStateChanged(auth, async user => {
  if (!user) {
    state.user = null;
    state.profile = null;

    document.body.classList.add("login-active");

    if ($("loginView")) $("loginView").classList.remove("hidden");
    if ($("appView")) $("appView").classList.add("hidden");
    if ($("logoutBtn")) $("logoutBtn").classList.add("hidden");

    return;
  }

  state.user = user;

  document.body.classList.remove("login-active");

  if ($("loginView")) $("loginView").classList.add("hidden");
  if ($("appView")) $("appView").classList.remove("hidden");
  if ($("logoutBtn")) $("logoutBtn").classList.remove("hidden");

  updateConnectionStatus();

  try {
    let profile = null;

    try {
      const snapshot = await getDoc(doc(db, "users", user.uid));

      if (snapshot.exists()) {
        profile = {
          id: snapshot.id,
          ...snapshot.data()
        };

        saveProfileToCache(user.uid, profile);
      }
    } catch (firebaseError) {
      console.warn("Não foi possível carregar o perfil do Firebase.", firebaseError);
    }

    if (!profile) {
      profile = getProfileFromCache(user.uid);
    }

    if (!profile) {
      toast("Usuário autenticado, mas sem perfil cadastrado.");
      return;
    }

    if (profile.active === false) {
      toast("Este usuário está inativo. Procure a administração.");
      await signOut(auth);
      return;
    }

    state.profile = profile;

    if ($("userName")) {
      $("userName").textContent = profile.name || user.email || "Usuário";
    }

    if ($("userRole")) {
      $("userRole").textContent = roleLabel(profile.role);
    }

    await renderByRole();
  } catch (error) {
    console.error("Erro ao carregar perfil/aplicativo:", error);
    toast("Erro ao carregar seu perfil.");
  }
});

/* =========================================================
   PERFIS
========================================================= */

function roleLabel(role) {
  return ({
    admin: "Administrador",
    driver: "Motorista",
    recipient: "Beneficiário"
  })[role] || role || "Usuário";
}

async function renderByRole() {
  ["adminPanel", "driverPanel", "recipientPanel"].forEach(id => {
    if ($(id)) $(id).classList.add("hidden");
  });

  if (state.profile.role === "admin") {
    if ($("adminPanel")) $("adminPanel").classList.remove("hidden");
    await renderAdmin();
  }

  if (state.profile.role === "driver") {
    if ($("driverPanel")) $("driverPanel").classList.remove("hidden");
    await renderDriver();
  }

  if (state.profile.role === "recipient") {
    if ($("recipientPanel")) $("recipientPanel").classList.remove("hidden");
    await renderRecipient();
  }
}

/* =========================================================
   ADMIN
========================================================= */

async function renderAdmin() {
  try {
    const householdSnapshot = await getDocs(collection(db, "households"));

    state.households = householdSnapshot.docs
      .map(item => ({
        id: item.id,
        ...item.data()
      }))
      .sort((a, b) =>
        String(a.name || "").localeCompare(String(b.name || ""), "pt-BR")
      );

    const deliverySnapshot = await getDocs(
      query(collection(db, "deliveries"), limit(100))
    );

    state.deliveries = deliverySnapshot.docs
      .map(item => ({
        id: item.id,
        ...item.data()
      }))
      .sort((a, b) =>
        String(b.scheduledDate || "").localeCompare(String(a.scheduledDate || ""))
      );

    renderAdminMenu();
  } catch (error) {
    console.error("Erro no painel administrativo:", error);

    if ($("adminPanel")) {
      $("adminPanel").innerHTML = `
        <div class="card">
          <h2>Erro ao carregar o painel</h2>
          <p>Não foi possível carregar os dados administrativos.</p>
          <p class="small">${esc(error.message)}</p>
        </div>
      `;
    }
  }
}

/* =========================================================
   MENU ADMINISTRATIVO
========================================================= */

function renderAdminMenu() {
  const pending = state.deliveries.filter(item => item.status === "scheduled").length;
  const completed = state.deliveries.filter(item => item.status === "completed").length;
  const awaiting = state.deliveries.filter(item => item.status === "awaiting_confirmation").length;

  $("adminPanel").innerHTML = `
    <div class="card">
      <div class="panel-title">
        <div>
          <h2>Painel administrativo</h2>
          <p class="small">Gestão do programa Água para Todos</p>
        </div>
      </div>

      <div class="stats">
        <div class="stat"><b>${state.households.length}</b> famílias</div>
        <div class="stat"><b>${pending}</b> programadas</div>
        <div class="stat"><b>${awaiting}</b> aguardando</div>
        <div class="stat"><b>${completed}</b> concluídas</div>
      </div>
    </div>

    <div class="card">
      <div class="panel-title"><h2>Cadastros</h2></div>

      <div class="grid">
        <div class="item" style="cursor:pointer" data-admin-menu="households">
          <h3>👨‍👩‍👧‍👦 Famílias / Beneficiários</h3>
          <p>Cadastrar, consultar e editar as famílias atendidas.</p>
        </div>

        <div class="item" style="cursor:pointer" data-admin-menu="drivers">
          <h3>🚚 Motoristas</h3>
          <p>Cadastrar, consultar e editar os motoristas.</p>
        </div>

        <div class="item" style="cursor:pointer" data-admin-menu="users">
          <h3>👤 Usuários</h3>
          <p>Consultar e editar usuários e seus perfis.</p>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="panel-title"><h2>Operações</h2></div>

      <div class="grid">
        <div class="item" style="cursor:pointer" data-admin-menu="new-delivery">
          <h3>📅 Programar entrega</h3>
          <p>Criar uma nova entrega e selecionar o motorista.</p>
        </div>

        <div class="item" style="cursor:pointer" data-admin-menu="scheduled">
          <h3>🚚 Entregas programadas</h3>
          <p>Visualizar e editar entregas ainda não realizadas.</p>
          <span class="pill scheduled">${pending}</span>
        </div>

        <div class="item" style="cursor:pointer" data-admin-menu="awaiting">
          <h3>⏳ Aguardando confirmação</h3>
          <p>Entregas aguardando confirmação do beneficiário.</p>
          <span class="pill scheduled">${awaiting}</span>
        </div>

        <div class="item" style="cursor:pointer" data-admin-menu="completed">
          <h3>✅ Entregas concluídas</h3>
          <p>Entregas finalizadas e confirmadas.</p>
          <span class="pill completed">${completed}</span>
        </div>

        <div class="item" style="cursor:pointer" data-admin-menu="history">
          <h3>📋 Histórico</h3>
          <p>Consultar todas as entregas registradas.</p>
        </div>
      </div>
    </div>

    <div id="adminContent" style="margin-top:20px"></div>
  `;

  document.querySelectorAll("[data-admin-menu]").forEach(button => {
    button.onclick = () => handleAdminMenu(button.dataset.adminMenu);
  });
}

async function handleAdminMenu(section) {
  if (section === "households") return renderAdminHouseholds();
  if (section === "drivers") return renderAdminDrivers();
  if (section === "users") return renderAdminUsers();
  if (section === "new-delivery") return showDeliveryForm();
  if (section === "scheduled") return renderAdminDeliveries("scheduled", "Entregas programadas");
  if (section === "awaiting") return renderAdminDeliveries("awaiting_confirmation", "Aguardando confirmação");
  if (section === "completed") return renderAdminDeliveries("completed", "Entregas concluídas");
  if (section === "history") return renderAdminDeliveries("all", "Histórico de entregas");
}

/* =========================================================
   FAMÍLIAS
========================================================= */

function renderAdminHouseholds() {
  const content = $("adminContent");
  if (!content) return;

  content.innerHTML = `
    <div class="card">
      <div class="panel-title">
        <div>
          <h2>Famílias / Beneficiários</h2>
          <p class="small">${state.households.length} cadastro(s) encontrado(s).</p>
        </div>

        <div class="actions">
          <button class="primary" id="adminNewHousehold">
            + Cadastrar família
          </button>
        </div>
      </div>

      <div class="grid">
        ${
          state.households.map(householdCard).join("") ||
          "<p class='small'>Nenhuma família cadastrada.</p>"
        }
      </div>
    </div>
  `;

  $("adminNewHousehold").onclick = showHouseholdForm;

  document.querySelectorAll("[data-edit-household]").forEach(button => {
    button.onclick = () => showEditHouseholdForm(button.dataset.editHousehold);
  });
}

function householdCard(household) {
  const accessText = household.recipientUid ? "Acesso criado" : "Sem acesso";

  return `
    <div class="item">
      <div class="row">
        <h3>${esc(household.name || "Sem nome")}</h3>
        <span class="pill ${household.active === false ? "cancelled" : "completed"}">
          ${household.active === false ? "Inativa" : "Ativa"}
        </span>
      </div>

      <p>
        <b>Telefone:</b> ${esc(household.phone || "—")}
        ${household.cpf ? ` · <b>CPF:</b> ${esc(household.cpf)}` : ""}
      </p>

      <p><b>Comunidade:</b> ${esc(household.community || "—")}</p>
      <p><b>Endereço:</b> ${esc(household.address || "—")}</p>

      <p>
        <b>Pessoas:</b> ${esc(household.people || "—")}
        · <b>Frequência:</b> ${esc(household.frequency || "—")}
        · <b>Litros:</b> ${esc(household.defaultLiters || "—")} L
      </p>

      <p>
        <b>Acesso ao aplicativo:</b> ${accessText}
        ${
          household.recipientUid
            ? ` · Login pelo telefone ${esc(household.phone || "cadastrado")}`
            : ""
        }
      </p>

      <div class="actions">
        <button class="secondary" data-edit-household="${esc(household.id)}">
          ✏️ Editar cadastro
        </button>
      </div>
    </div>
  `;
}

/* =========================================================
   CADASTRAR FAMÍLIA E ACESSO
========================================================= */

function showHouseholdForm() {
  openModal(`
    <h2>Nova família / imóvel</h2>

    <form id="householdForm">
      <label>
        Nome do responsável
        <input id="hName" autocomplete="name" placeholder="Nome completo" required>
      </label>

      <label>
        CPF (opcional)
        <input id="hCpf" inputmode="numeric" placeholder="Apenas números">
      </label>

      <label>
        Telefone do beneficiário (com DDD)
        <input id="hPhone" type="tel" autocomplete="tel" placeholder="Ex: 84999998888" required>
      </label>

      <div class="notice">
        <b>Acesso do beneficiário</b><br>
        O beneficiário entrará no aplicativo usando este telefone e a senha definida abaixo. Não é necessário e-mail.
      </div>

      <label>
        Senha inicial
        <input id="hPassword" type="password" minlength="6" autocomplete="new-password" placeholder="Mínimo 6 dígitos" required>
      </label>

      <label>
        Confirmar senha
        <input id="hPasswordConfirm" type="password" minlength="6" autocomplete="new-password" placeholder="Repita a senha" required>
      </label>

      <label>
        Comunidade / zona rural
        <input id="hCommunity" placeholder="Ex: Serra Vermelha, Ponta do Mel" required>
      </label>

      <label>
        Endereço / referência
        <input id="hAddress" placeholder="Ponto de referência para o motorista" required>
      </label>

      <label>
        Quantidade de pessoas na casa
        <input id="hPeople" type="number" min="1" value="1" required>
      </label>

      <label>
        Frequência
        <select id="hFreq">
          <option>Semanal</option>
          <option>Quinzenal</option>
          <option>Mensal</option>
          <option>Conforme necessidade</option>
        </select>
      </label>

      <label>
        Litros programados por entrega
        <input id="hLiters" type="number" min="1" placeholder="Ex: 5000" required>
      </label>

      <div class="actions">
        <button type="button" class="secondary" id="cancelNewHousehold">Cancelar</button>
        <button class="primary" id="saveHousehold">Salvar família</button>
      </div>
    </form>
  `);

  $("cancelNewHousehold").onclick = closeModal;

  $("householdForm").onsubmit = async event => {
    event.preventDefault();

    const button = $("saveHousehold");
    const name = $("hName").value.trim();
    const cpf = $("hCpf").value.trim();
    const phone = $("hPhone").value.trim();
    const password = $("hPassword").value;
    const passwordConfirm = $("hPasswordConfirm").value;
    const community = $("hCommunity").value.trim();
    const address = $("hAddress").value.trim();
    const people = Number($("hPeople").value);
    const frequency = $("hFreq").value;
    const defaultLiters = Number($("hLiters").value);

    if (!name) return toast("Informe o nome do responsável.");

    let authEmail;
    try {
      authEmail = recipientAuthEmail(phone);
    } catch (error) {
      return toast(error.message);
    }

    if (password.length < 6) return toast("A senha precisa ter pelo menos 6 caracteres.");
    if (password !== passwordConfirm) return toast("As senhas não conferem.");
    if (!community) return toast("Informe a comunidade ou zona rural.");
    if (!address) return toast("Informe o endereço ou referência.");
    if (!Number.isFinite(people) || people < 1) return toast("Informe uma quantidade válida de pessoas.");
    if (!Number.isFinite(defaultLiters) || defaultLiters < 1) return toast("Informe uma quantidade válida de litros.");

    if (!secondaryAuth) return toast("Não foi possível preparar o cadastro do beneficiário.");

    let createdUser = null;
    let createdUserProfile = false;
    let createdHouseholdId = null;

    try {
      button.disabled = true;
      button.textContent = "Criando acesso...";

      const credential = await createUserWithEmailAndPassword(
        secondaryAuth,
        authEmail,
        password
      );

      createdUser = credential.user;

      const householdRef = await addDoc(collection(db, "households"), {
        name,
        cpf,
        phone,
        recipientUid: createdUser.uid,
        community,
        address,
        people,
        frequency,
        defaultLiters,
        active: true,
        createdAt: serverTimestamp(),
        createdBy: state.user.uid
      });

      createdHouseholdId = householdRef.id;

      await setDoc(doc(db, "users", createdUser.uid), {
        name,
        phone,
        authEmail,
        role: "recipient",
        active: true,
        householdId: createdHouseholdId,
        createdAt: serverTimestamp(),
        createdBy: state.user.uid
      });

      createdUserProfile = true;

      try {
        await signOutSecondary(secondaryAuth);
      } catch (_) {}

      closeModal();
      toast("Família cadastrada com sucesso.");
      await renderAdmin();
    } catch (error) {
      console.error("Erro ao cadastrar família e beneficiário:", error);

      if (createdHouseholdId) {
        try {
          await deleteDoc(doc(db, "households", createdHouseholdId));
        } catch (_) {}
      }

      if (createdUserProfile && createdUser) {
        try {
          await deleteDoc(doc(db, "users", createdUser.uid));
        } catch (_) {}
      }

      if (createdUser) {
        try {
          await deleteUser(createdUser);
        } catch (_) {}
      }

      try {
        await signOutSecondary(secondaryAuth);
      } catch (_) {}

      if (error.code === "auth/email-already-in-use") {
        toast("Já existe um acesso cadastrado com esse telefone.");
      } else {
        toast("Não foi possível cadastrar a família. Verifique a conexão.");
      }
    } finally {
      button.disabled = false;
      button.textContent = "Salvar família";
    }
  };
}

/* =========================================================
   EDITAR FAMÍLIA
========================================================= */

function showEditHouseholdForm(id) {
  const household = state.households.find(item => item.id === id);
  if (!household) return toast("Família não encontrada.");

  openModal(`
    <h2>Editar família / imóvel</h2>

    <form id="editHouseholdForm">
      <label>
        Nome do responsável
        <input id="ehName" value="${esc(household.name || "")}" required>
      </label>

      <label>
        CPF
        <input id="ehCpf" inputmode="numeric" value="${esc(household.cpf || "")}">
      </label>

      <label>
        Telefone
        <input id="ehPhone" value="${esc(household.phone || "")}" ${household.recipientUid ? "disabled" : ""} required>
      </label>

      <label>
        Comunidade / zona rural
        <input id="ehCommunity" value="${esc(household.community || "")}" required>
      </label>

      <label>
        Endereço / referência
        <input id="ehAddress" value="${esc(household.address || "")}" required>
      </label>

      <label>
        Quantidade de pessoas
        <input id="ehPeople" type="number" min="1" value="${esc(household.people || 1)}" required>
      </label>

      <label>
        Frequência
        <select id="ehFreq">
          <option ${household.frequency === "Semanal" ? "selected" : ""}>Semanal</option>
          <option ${household.frequency === "Quinzenal" ? "selected" : ""}>Quinzenal</option>
          <option ${household.frequency === "Mensal" ? "selected" : ""}>Mensal</option>
          <option ${household.frequency === "Conforme necessidade" ? "selected" : ""}>Conforme necessidade</option>
        </select>
      </label>

      <label>
        Litros programados por entrega
        <input id="ehLiters" type="number" min="1" value="${esc(household.defaultLiters || "")}" required>
      </label>

      <label>
        Situação
        <select id="ehActive">
          <option value="true" ${household.active !== false ? "selected" : ""}>Ativa</option>
          <option value="false" ${household.active === false ? "selected" : ""}>Inativa</option>
        </select>
      </label>

      <div class="actions">
        <button type="button" class="secondary" id="cancelEdit">Cancelar</button>
        <button type="submit" class="primary">Salvar alterações</button>
      </div>
    </form>
  `);

  $("cancelEdit").onclick = closeModal;

  $("editHouseholdForm").onsubmit = async event => {
    event.preventDefault();

    try {
      const changes = {
        name: $("ehName").value.trim(),
        cpf: $("ehCpf").value.trim(),
        community: $("ehCommunity").value.trim(),
        address: $("ehAddress").value.trim(),
        people: Number($("ehPeople").value),
        frequency: $("ehFreq").value,
        defaultLiters: Number($("ehLiters").value),
        active: $("ehActive").value === "true",
        updatedAt: serverTimestamp(),
        updatedBy: state.user.uid
      };

      if (!household.recipientUid) {
        changes.phone = $("ehPhone").value.trim();
      }

      await updateDoc(doc(db, "households", id), changes);

      closeModal();
      toast("Cadastro atualizado com sucesso.");
      await renderAdmin();
    } catch (error) {
      console.error("Erro ao atualizar família:", error);
      toast("Não foi possível atualizar o cadastro.");
    }
  };
}

/* =========================================================
   MOTORISTAS
========================================================= */

async function loadDrivers() {
  const snapshot = await getDocs(
    query(
      collection(db, "users"),
      where("role", "==", "driver"),
      limit(100)
    )
  );

  state.drivers = snapshot.docs
    .map(item => ({ id: item.id, ...item.data() }))
    .sort((a, b) =>
      String(a.name || "").localeCompare(String(b.name || ""), "pt-BR")
    );

  return state.drivers;
}

async function renderAdminDrivers() {
  const content = $("adminContent");
  if (!content) return;

  try {
    await loadDrivers();

    content.innerHTML = `
      <div class="card">
        <div class="panel-title">
          <div>
            <h2>Motoristas</h2>
            <p class="small">${state.drivers.length} motorista(s) cadastrado(s).</p>
          </div>

          <div class="actions">
            <button class="primary" id="newDriverBtn">+ Cadastrar motorista</button>
          </div>
        </div>

        <div class="grid">
          ${
            state.drivers.map(driver => `
              <div class="item">
                <div class="row">
                  <h3>${esc(driver.name || "Motorista")}</h3>
                  <span class="pill ${driver.active === false ? "cancelled" : "completed"}">
                    ${driver.active === false ? "Inativo" : "Ativo"}
                  </span>
                </div>

                <p><b>E-mail:</b> ${esc(driver.email || "Não informado")}</p>
                <p><b>Telefone:</b> ${esc(driver.phone || "Não informado")}</p>

                <div class="actions">
                  <button class="secondary" data-edit-driver="${esc(driver.id)}">
                    ✏️ Editar motorista
                  </button>
                </div>
              </div>
            `).join("") || "<p class='small'>Nenhum motorista cadastrado.</p>"
          }
        </div>
      </div>
    `;

    $("newDriverBtn").onclick = showDriverForm;

    document.querySelectorAll("[data-edit-driver]").forEach(button => {
      button.onclick = () => showEditDriverForm(button.dataset.editDriver);
    });
  } catch (error) {
    console.error("Erro ao carregar motoristas:", error);
    content.innerHTML = `
      <div class="card">
        <h2>Erro ao carregar motoristas</h2>
        <p class="small">${esc(error.message)}</p>
      </div>
    `;
  }
}

function showDriverForm() {
  openModal(`
    <h2>Cadastrar motorista</h2>

    <form id="driverForm">
      <label>
        Nome completo
        <input id="driverName" type="text" autocomplete="name" placeholder="Nome do motorista" required>
      </label>

      <label>
        E-mail de acesso
        <input id="driverEmail" type="email" autocomplete="email" placeholder="motorista@exemplo.com" required>
      </label>

      <label>
        Telefone
        <input id="driverPhone" type="tel" autocomplete="tel" placeholder="84999998888" required>
      </label>

      <label>
        Senha inicial
        <input id="driverPassword" type="password" minlength="6" autocomplete="new-password" placeholder="Mínimo 6 dígitos" required>
      </label>

      <div class="actions">
        <button type="button" class="secondary" id="cancelDriver">Cancelar</button>
        <button type="submit" class="primary" id="saveDriver">Cadastrar motorista</button>
      </div>
    </form>
  `);

  $("cancelDriver").onclick = closeModal;

  $("driverForm").onsubmit = async event => {
    event.preventDefault();

    const button = $("saveDriver");
    const name = $("driverName").value.trim();
    const email = $("driverEmail").value.trim().toLowerCase();
    const phone = $("driverPhone").value.trim();
    const password = $("driverPassword").value;

    if (!name || !email || !phone) return toast("Preencha todos os campos.");
    if (password.length < 6) return toast("A senha precisa ter pelo menos 6 caracteres.");
    if (!secondaryAuth) return toast("Não foi possível preparar o cadastro do motorista.");

    try {
      button.disabled = true;
      button.textContent = "Cadastrando...";

      const credential = await createUserWithEmailAndPassword(secondaryAuth, email, password);
      const newUser = credential.user;

      await setDoc(doc(db, "users", newUser.uid), {
        name,
        email,
        phone,
        role: "driver",
        active: true,
        createdAt: serverTimestamp(),
        createdBy: state.user.uid
      });

      await signOutSecondary(secondaryAuth);

      closeModal();
      toast("Motorista cadastrado com sucesso.");
      await renderAdmin();
      await renderAdminDrivers();
    } catch (error) {
      console.error("Erro ao cadastrar motorista:", error);
      toast("Não foi possível cadastrar o motorista. Verifique os dados.");
      try {
        await signOutSecondary(secondaryAuth);
      } catch (_) {}
    } finally {
      button.disabled = false;
      button.textContent = "Cadastrar motorista";
    }
  };
}

function showEditDriverForm(id) {
  const driver = state.drivers.find(item => item.id === id);
  if (!driver) return toast("Motorista não encontrado.");

  openModal(`
    <h2>Editar motorista</h2>

    <form id="editDriverForm">
      <label>
        Nome completo
        <input id="edDriverName" value="${esc(driver.name || "")}" required>
      </label>

      <label>
        E-mail
        <input value="${esc(driver.email || "")}" disabled>
      </label>

      <label>
        Telefone
        <input id="edDriverPhone" value="${esc(driver.phone || "")}" required>
      </label>

      <label>
        Situação
        <select id="edDriverActive">
          <option value="true" ${driver.active !== false ? "selected" : ""}>Ativo</option>
          <option value="false" ${driver.active === false ? "selected" : ""}>Inativo</option>
        </select>
      </label>

      <div class="actions">
        <button type="button" class="secondary" id="cancelEditDriver">Cancelar</button>
        <button type="submit" class="primary">Salvar alterações</button>
      </div>
    </form>
  `);

  $("cancelEditDriver").onclick = closeModal;

  $("editDriverForm").onsubmit = async event => {
    event.preventDefault();

    try {
      await updateDoc(doc(db, "users", id), {
        name: $("edDriverName").value.trim(),
        phone: $("edDriverPhone").value.trim(),
        active: $("edDriverActive").value === "true",
        updatedAt: serverTimestamp(),
        updatedBy: state.user.uid
      });

      closeModal();
      toast("Motorista atualizado com sucesso.");
      await renderAdmin();
      await renderAdminDrivers();
    } catch (error) {
      console.error("Erro ao editar motorista:", error);
      toast("Não foi possível atualizar o motorista.");
    }
  };
}

/* =========================================================
   USUÁRIOS
========================================================= */

async function renderAdminUsers() {
  const content = $("adminContent");
  if (!content) return;

  try {
    const snapshot = await getDocs(query(collection(db, "users"), limit(100)));

    const users = snapshot.docs
      .map(item => ({ id: item.id, ...item.data() }))
      .sort((a, b) =>
        String(a.name || "").localeCompare(String(b.name || ""), "pt-BR")
      );

    state.users = users;

    content.innerHTML = `
      <div class="card">
        <div class="panel-title">
          <div>
            <h2>Usuários</h2>
            <p class="small">${users.length} usuário(s) encontrado(s).</p>
          </div>
        </div>

        <div class="grid">
          ${
            users.map(user => `
              <div class="item">
                <div class="row">
                  <h3>${esc(user.name || "Usuário")}</h3>
                  <span class="pill ${user.active === false ? "cancelled" : "completed"}">
                    ${user.active === false ? "Inativo" : roleLabel(user.role)}
                  </span>
                </div>

                <p>
                  <b>Login:</b>
                  ${
                    user.role === "recipient"
                      ? "Telefone: " + esc(user.phone || "Não informado")
                      : esc(user.email || "Não informado")
                  }
                </p>

                <p><b>Perfil:</b> ${esc(roleLabel(user.role))}</p>

                <div class="actions">
                  <button class="secondary" data-edit-user="${esc(user.id)}">
                    ✏️ Editar usuário
                  </button>
                </div>
              </div>
            `).join("") || "<p class='small'>Nenhum usuário cadastrado.</p>"
          }
        </div>
      </div>
    `;

    document.querySelectorAll("[data-edit-user]").forEach(button => {
      button.onclick = () => showEditUserForm(button.dataset.editUser);
    });
  } catch (error) {
    console.error("Erro ao carregar usuários:", error);
    content.innerHTML = `
      <div class="card">
        <h2>Erro ao carregar usuários</h2>
        <p class="small">${esc(error.message)}</p>
      </div>
    `;
  }
}

function showEditUserForm(id) {
  const user = state.users.find(item => item.id === id);
  if (!user) return toast("Usuário não encontrado.");

  openModal(`
    <h2>Editar usuário</h2>

    <form id="editUserForm">
      <label>
        Nome
        <input id="euName" value="${esc(user.name || "")}" required>
      </label>

      <label>
        Login
        <input value="${esc(user.role === "recipient" ? user.phone || "" : user.email || "")}" disabled>
      </label>

      <label>
        Telefone
        <input id="euPhone" value="${esc(user.phone || "")}" ${user.role === "recipient" ? "disabled" : ""}>
      </label>

      <label>
        Perfil
        <select id="euRole">
          <option value="admin" ${user.role === "admin" ? "selected" : ""}>Administrador</option>
          <option value="driver" ${user.role === "driver" ? "selected" : ""}>Motorista</option>
          <option value="recipient" ${user.role === "recipient" ? "selected" : ""}>Beneficiário</option>
        </select>
      </label>

      <label>
        Situação
        <select id="euActive">
          <option value="true" ${user.active !== false ? "selected" : ""}>Ativo</option>
          <option value="false" ${user.active === false ? "selected" : ""}>Inativo</option>
        </select>
      </label>

      <div class="actions">
        <button type="button" class="secondary" id="cancelEditUser">Cancelar</button>
        <button type="submit" class="primary">Salvar alterações</button>
      </div>
    </form>
  `);

  $("cancelEditUser").onclick = closeModal;

  $("editUserForm").onsubmit = async event => {
    event.preventDefault();

    try {
      const changes = {
        name: $("euName").value.trim(),
        role: $("euRole").value,
        active: $("euActive").value === "true",
        updatedAt: serverTimestamp(),
        updatedBy: state.user.uid
      };

      if (user.role !== "recipient") {
        changes.phone = $("euPhone").value.trim();
      }

      await updateDoc(doc(db, "users", id), changes);

      closeModal();
      toast("Usuário atualizado com sucesso.");
      await renderAdmin();
      await renderAdminUsers();
    } catch (error) {
      console.error("Erro ao editar usuário:", error);
      toast("Não foi possível atualizar o usuário.");
    }
  };
}

/* =========================================================
   ENTREGAS ADMINISTRATIVAS
========================================================= */

function renderAdminDeliveries(filter, title) {
  const content = $("adminContent");
  if (!content) return;

  const list = filter === "all"
    ? state.deliveries
    : state.deliveries.filter(item => item.status === filter);

  content.innerHTML = `
    <div class="card">
      <div class="panel-title">
        <div>
          <h2>${esc(title)}</h2>
          <p class="small">${list.length} entrega(s) encontrada(s).</p>
        </div>

        <div class="actions">
          <button class="yellow" id="adminNewDelivery">+ Programar entrega</button>
        </div>
      </div>

      <div class="grid">
        ${
          list.map(deliveryCard).join("") ||
          "<p class='small'>Nenhuma entrega encontrada.</p>"
        }
      </div>
    </div>
  `;

  $("adminNewDelivery").onclick = showDeliveryForm;

  document.querySelectorAll("[data-view-delivery]").forEach(button => {
    button.onclick = () => showDeliveryDetails(button.dataset.viewDelivery);
  });

  document.querySelectorAll("[data-edit-delivery]").forEach(button => {
    button.onclick = () => showEditDeliveryForm(button.dataset.editDelivery);
  });
}

function deliveryCard(delivery) {
  const canEdit = ["scheduled", "awaiting_confirmation"].includes(delivery.status);

  return `
    <div class="item">
      <div class="row">
        <h3>${esc(delivery.recipientName || "Beneficiário")}</h3>
        <span class="pill ${esc(delivery.status)}">
          ${statusLabel(delivery.status)}
        </span>
      </div>

      <p>
        <b>Data:</b> ${esc(delivery.scheduledDate || "—")}
        · <b>Quantidade:</b> ${esc(delivery.plannedLiters || "—")} L
      </p>

      <p>
        <b>Local:</b> ${esc(delivery.address || "—")}
        · <b>Motorista:</b> ${esc(delivery.driverName || "—")}
      </p>

      ${
        delivery.completedAt
          ? `<p><b>Registro:</b> ${fmtDate(delivery.completedAt)} · <b>Recebido:</b> ${esc(delivery.receivedLiters ?? "—")} L</p>`
          : ""
      }

      <div class="actions">
        <button class="secondary" data-view-delivery="${esc(delivery.id)}">
          👁️ Ver detalhes
        </button>

        ${
          canEdit
            ? `<button class="secondary" data-edit-delivery="${esc(delivery.id)}">✏️ Editar</button>`
            : ""
        }
      </div>
    </div>
  `;
}

/* =========================================================
   DETALHES DA ENTREGA
========================================================= */

async function showDeliveryDetails(id) {
  try {
    const snapshot = await getDoc(doc(db, "deliveries", id));

    if (!snapshot.exists()) return toast("Entrega não encontrada.");

    let delivery = {
      id: snapshot.id,
      ...snapshot.data()
    };

    if (
      ["scheduled", "awaiting_confirmation"].includes(delivery.status) &&
      !delivery.confirmationPin
    ) {
      const confirmationPin = generateConfirmationPin();

      await updateDoc(doc(db, "deliveries", id), {
        confirmationPin,
        updatedAt: serverTimestamp(),
        updatedBy: state.user.uid
      });

      delivery.confirmationPin = confirmationPin;

      state.deliveries = state.deliveries.map(item =>
        item.id === id ? { ...item, confirmationPin } : item
      );
    }

    const presentText = delivery.recipientPresent === true
      ? "Sim"
      : delivery.recipientPresent === false
        ? "Não"
        : "Não informado";

    const signatureHtml = delivery.signatureData
      ? `
        <div style="margin-top:16px">
          <h3>Assinatura do beneficiário</h3>
          <div style="background:#fff;border:1px solid #dfe5ee;border-radius:12px;padding:8px">
            <img src="${esc(delivery.signatureData)}" alt="Assinatura" style="display:block;width:100%;max-width:480px;height:auto">
          </div>
        </div>
      `
      : "";

    const photoHtml = delivery.photoUrl
      ? `
        <div style="margin-top:16px">
          <h3>Foto de comprovação</h3>
          <img src="${esc(delivery.photoUrl)}" alt="Foto da entrega" style="display:block;width:100%;max-width:540px;border-radius:12px">
        </div>
      `
      : "";

    openModal(`
      <h2>Detalhes da entrega</h2>

      <div class="notice">
        <b>Situação:</b> ${esc(statusLabel(delivery.status))}
      </div>

      <div class="item">
        <h3>PIN do beneficiário</h3>
        <p style="font-size:1.6rem;font-weight:800;letter-spacing:4px;color:var(--navy);margin:4px 0">
          ${esc(delivery.confirmationPin || "Não gerado")}
        </p>
      </div>

      <div class="item">
        <h3>Beneficiário e Local</h3>
        <p><b>Nome:</b> ${esc(delivery.recipientName || "—")}</p>
        <p><b>Telefone:</b> ${esc(delivery.recipientPhone || "—")}</p>
        <p><b>Comunidade:</b> ${esc(delivery.community || "—")}</p>
        <p><b>Endereço:</b> ${esc(delivery.address || "—")}</p>
      </div>

      <div class="item">
        <h3>Dados Operacionais</h3>
        <p><b>Data:</b> ${esc(delivery.scheduledDate || "—")}</p>
        <p><b>Planejado:</b> ${esc(delivery.plannedLiters ?? "—")} L</p>
        <p><b>Entregue:</b> ${delivery.receivedLiters != null ? `${esc(delivery.receivedLiters)} L` : "Pendente"}</p>
        <p><b>Motorista:</b> ${esc(delivery.driverName || "—")}</p>
        <p><b>Presente no local:</b> ${presentText}</p>
      </div>

      ${signatureHtml}
      ${photoHtml}

      <div class="actions" style="margin-top:18px">
        ${
          ["scheduled", "awaiting_confirmation"].includes(delivery.status)
            ? `<button type="button" class="secondary" id="editFromDetails">✏️ Editar programação</button>`
            : ""
        }
        <button type="button" class="primary" id="closeDeliveryDetails">Fechar</button>
      </div>
    `);

    if ($("closeDeliveryDetails")) $("closeDeliveryDetails").onclick = closeModal;
    if ($("editFromDetails")) {
      $("editFromDetails").onclick = () => {
        closeModal();
        showEditDeliveryForm(id);
      };
    }
  } catch (error) {
    console.error("Erro ao carregar detalhes:", error);
    toast("Não foi possível carregar os detalhes.");
  }
}

/* =========================================================
   EDITAR ENTREGA
========================================================= */

async function showEditDeliveryForm(id) {
  const delivery = state.deliveries.find(item => item.id === id);
  if (!delivery) return toast("Entrega não encontrada.");

  try {
    await loadDrivers();
  } catch (error) {
    return toast("Erro ao carregar motoristas.");
  }

  openModal(`
    <h2>Editar entrega</h2>

    <form id="editDeliveryForm">
      <label>
        Família / beneficiário
        <select id="edDeliveryHousehold">
          ${
            state.households
              .filter(h => h.active !== false || h.id === delivery.householdId)
              .map(h => `
                <option value="${esc(h.id)}" ${h.id === delivery.householdId ? "selected" : ""}>
                  ${esc(h.name)} — ${esc(h.community)}
                </option>
              `).join("")
          }
        </select>
      </label>

      <label>
        Data programada
        <input id="edDeliveryDate" type="date" value="${esc(delivery.scheduledDate || "")}" required>
      </label>

      <label>
        Quantidade planejada (litros)
        <input id="edDeliveryLiters" type="number" min="1" value="${esc(delivery.plannedLiters || "")}" required>
      </label>

      <label>
        Motorista
        <select id="edDeliveryDriver" required>
          ${
            state.drivers.map(driver => `
              <option value="${esc(driver.id)}" ${driver.id === delivery.driverUid ? "selected" : ""}>
                ${esc(driver.name || "Motorista")}
              </option>
            `).join("")
          }
        </select>
      </label>

      <label>
        Observação
        <textarea id="edDeliveryNote">${esc(delivery.note || "")}</textarea>
      </label>

      <div class="actions">
        <button type="button" class="secondary" id="cancelEditDelivery">Cancelar</button>
        <button type="submit" class="primary">Salvar alterações</button>
      </div>
    </form>
  `);

  $("cancelEditDelivery").onclick = closeModal;

  $("editDeliveryForm").onsubmit = async event => {
    event.preventDefault();

    try {
      const household = state.households.find(item => item.id === $("edDeliveryHousehold").value);
      const driver = state.drivers.find(item => item.id === $("edDeliveryDriver").value);

      if (!household || !driver) return toast("Selecione os dados corretamente.");

      await updateDoc(doc(db, "deliveries", id), {
        householdId: household.id,
        recipientUid: household.recipientUid || null,
        recipientName: household.name,
        address: household.address,
        community: household.community,
        recipientPhone: household.phone,
        scheduledDate: $("edDeliveryDate").value,
        plannedLiters: Number($("edDeliveryLiters").value),
        driverUid: driver.id,
        driverName: driver.name || "Motorista",
        note: $("edDeliveryNote").value.trim(),
        updatedAt: serverTimestamp(),
        updatedBy: state.user.uid
      });

      closeModal();
      toast("Entrega atualizada com sucesso.");
      await renderAdmin();
    } catch (error) {
      console.error("Erro ao editar entrega:", error);
      toast("Não foi possível atualizar a entrega.");
    }
  };
}

/* =========================================================
   PROGRAMAR ENTREGA
========================================================= */

async function showDeliveryForm() {
  if (!state.households.length) return toast("Cadastre uma família primeiro.");

  try {
    await loadDrivers();
  } catch (error) {
    return toast("Erro ao carregar motoristas.");
  }

  const activeHouseholds = state.households.filter(h => h.active !== false);
  const activeDrivers = state.drivers.filter(d => d.active !== false);

  if (!activeHouseholds.length) return toast("Nenhuma família ativa encontrada.");
  if (!activeDrivers.length) return toast("Nenhum motorista ativo encontrado.");

  openModal(`
    <h2>Programar entrega</h2>

    <form id="deliveryForm">
      <label>
        Família
        <select id="dHousehold" required>
          ${
            activeHouseholds.map(h => `
              <option value="${esc(h.id)}">${esc(h.name)} — ${esc(h.community)}</option>
            `).join("")
          }
        </select>
      </label>

      <label>
        Data
        <input id="dDate" type="date" required>
      </label>

      <label>
        Quantidade planejada (litros)
        <input id="dLiters" type="number" min="1" required>
      </label>

      <label>
        Motorista
        <select id="dDriverUid" required>
          <option value="" disabled selected>Selecione o motorista</option>
          ${
            activeDrivers.map(d => `
              <option value="${esc(d.id)}">${esc(d.name || "Motorista")}</option>
            `).join("")
          }
        </select>
      </label>

      <label>
        Observação
        <textarea id="dNote" placeholder="Instruções de acesso ao reservatório"></textarea>
      </label>

      <div class="actions">
        <button type="button" class="secondary" id="cancelNewDelivery">Cancelar</button>
        <button type="submit" class="primary" id="saveNewDelivery">Programar entrega</button>
      </div>
    </form>
  `);

  $("cancelNewDelivery").onclick = closeModal;

  $("dHousehold").onchange = () => {
    const household = state.households.find(item => item.id === $("dHousehold").value);
    $("dLiters").value = household?.defaultLiters || "";
  };

  $("dHousehold").dispatchEvent(new Event("change"));

  $("deliveryForm").onsubmit = async event => {
    event.preventDefault();

    const button = $("saveNewDelivery");
    if (button.disabled) return;

    try {
      const household = state.households.find(item => item.id === $("dHousehold").value);
      const scheduledDate = $("dDate").value;
      const plannedLiters = Number($("dLiters").value);
      const driverUid = $("dDriverUid").value.trim();
      const driver = state.drivers.find(item => item.id === driverUid);

      if (!scheduledDate || !plannedLiters || !driver) {
        return toast("Preencha todos os campos obrigatórios.");
      }

      button.disabled = true;
      button.textContent = "Programando...";

      const confirmationPin = generateConfirmationPin();

      const deliveryData = {
        householdId: household.id,
        recipientUid: household.recipientUid || null,
        recipientName: household.name,
        address: household.address,
        community: household.community,
        recipientPhone: household.phone || "",
        scheduledDate,
        plannedLiters,
        driverUid,
        driverName: driver.name || "Motorista",
        note: $("dNote").value.trim(),
        confirmationPin,
        status: "scheduled",
        recipientConfirmed: false,
        createdAt: serverTimestamp(),
        createdBy: state.user.uid
      };

      await addDoc(collection(db, "deliveries"), deliveryData);

      closeModal();

      openModal(`
        <h2>Entrega programada com sucesso!</h2>

        <div class="item" style="text-align:center">
          <p>PIN de confirmação gerado para este abastecimento:</p>
          <p style="font-size:2.2rem;font-weight:800;letter-spacing:6px;color:var(--navy);margin:10px 0">
            ${esc(confirmationPin)}
          </p>
          <p class="small">Repasse este código ao beneficiário.</p>
        </div>

        <div class="actions">
          <button type="button" class="secondary" id="copyDeliveryPin">Copiar PIN</button>
          <button type="button" class="primary" id="closeDeliveryPin">Concluir</button>
        </div>
      `);

      $("copyDeliveryPin").onclick = async () => {
        try {
          await navigator.clipboard.writeText(confirmationPin);
          toast("PIN copiado.");
        } catch (_) {
          toast("Anote o PIN exibido acima.");
        }
      };

      $("closeDeliveryPin").onclick = async () => {
        closeModal();
        await renderAdmin();
      };
    } catch (error) {
      console.error("Erro ao programar entrega:", error);
      toast("Não foi possível programar a entrega.");
      if (button) {
        button.disabled = false;
        button.textContent = "Programar entrega";
      }
    }
  };
}

/* =========================================================
   STATUS
========================================================= */

function statusLabel(status) {
  return ({
    scheduled: "Programada",
    awaiting_confirmation: "Aguardando confirmação",
    completed: "Concluída",
    absent: "Ninguém no local",
    cancelled: "Cancelada"
  })[status] || status || "—";
}

/* =========================================================
   MOTORISTA
========================================================= */

async function renderDriver() {
  let loadedFromFirebase = false;

  try {
    const snapshot = await getDocs(
      query(
        collection(db, "deliveries"),
        where("driverUid", "==", state.user.uid),
        limit(100)
      )
    );

    state.deliveries = snapshot.docs
      .map(item => ({ id: item.id, ...item.data() }))
      .sort((a, b) =>
        String(a.scheduledDate || "").localeCompare(String(b.scheduledDate || ""))
      );

    loadedFromFirebase = true;
    await saveDriverDeliveriesToCache(state.deliveries);
  } catch (error) {
    console.warn("Recuperando do cache offline:", error);
    state.deliveries = await getCachedDriverDeliveries(state.user.uid);
  }

  const offlineMessage = !navigator.onLine
    ? `<div class="notice"><b>Modo offline:</b> Registros serão sincronizados quando houver conexão.</div>`
    : `<div class="notice"><b>Status da rota:</b> Todas as entregas estão sincronizadas.</div>`;

  $("driverPanel").innerHTML = `
    <div class="card">
      <div class="panel-title"><h2>Minhas entregas</h2></div>

      ${offlineMessage}

      ${
        !state.deliveries.length
          ? `<p class="small" style="margin-top:16px">Nenhuma entrega atribuída no momento.</p>`
          : `
            <div class="grid" style="margin-top:14px">
              ${state.deliveries.map(driverCard).join("")}
            </div>
          `
      }
    </div>
  `;

  document.querySelectorAll("[data-complete]").forEach(button => {
    button.onclick = () => showCompleteForm(button.dataset.complete);
  });
}

function driverCard(delivery) {
  const action = delivery.status === "scheduled"
    ? `
      <div class="actions" style="margin-top:12px">
        <button class="primary" data-complete="${esc(delivery.id)}" style="width:100%">
          🚚 Registrar entrega
        </button>
      </div>
    `
    : "";

  return `
    <div class="item">
      <div class="row">
        <h3>${esc(delivery.recipientName || "Beneficiário")}</h3>
        <span class="pill ${esc(delivery.status)}">
          ${statusLabel(delivery.status)}
        </span>
      </div>

      <p>
        <b>Data:</b> ${esc(delivery.scheduledDate || "—")}
        · <b>Volume:</b> ${esc(delivery.plannedLiters ?? "—")} L
      </p>

      <p>
        <b>Comunidade:</b> ${esc(delivery.community || "—")}<br>
        <b>Endereço:</b> ${esc(delivery.address || "—")}
      </p>

      ${action}
    </div>
  `;
}

/* =========================================================
   REGISTRAR FORNECIMENTO
========================================================= */

function showCompleteForm(id) {
  const delivery = state.deliveries.find(item => item.id === id);
  if (!delivery || delivery.status !== "scheduled") return;

  openModal(`
    <h2>Registrar fornecimento</h2>

    <form id="completeForm">
      <label>
        Quantidade entregue (litros)
        <input id="cLiters" type="number" min="1" value="${esc(delivery.plannedLiters ?? "")}" required>
      </label>

      <label>
        Havia alguém no local?
        <select id="cPresence">
          <option value="yes">Sim — beneficiário presente</option>
          <option value="no">Não — ninguém no local</option>
        </select>
      </label>

      <div id="recipientFields">
        <label>
          PIN de confirmação do beneficiário
          <input id="cPin" inputmode="numeric" maxlength="6" placeholder="Código de 6 dígitos">
        </label>

        <label>Assinatura digital do beneficiário</label>
        <canvas id="signature" class="signature"></canvas>

        <div class="actions" style="margin-top:6px">
          <button type="button" class="secondary" id="clearSig">Limpar assinatura</button>
        </div>
      </div>

      <div id="photoFields" class="hidden">
        <label>
          Foto de comprovação do imóvel/caixa d'água
          <input id="cPhoto" type="file" accept="image/*" capture="environment">
        </label>
      </div>

      <label>
        Observação
        <textarea id="cNote" placeholder="Ex: abastecido reservatório superior"></textarea>
      </label>

      <div class="actions">
        <button type="button" class="secondary" id="cancelComplete">Cancelar</button>
        <button class="primary">Concluir registro</button>
      </div>
    </form>
  `);

  $("cancelComplete").onclick = closeModal;

  const canvas = $("signature");
  const context = canvas.getContext("2d");
  let drawing = false;

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;

    canvas.width = rect.width * ratio;
    canvas.height = rect.height * ratio;

    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.lineWidth = 2.5;
    context.lineCap = "round";
    context.strokeStyle = "#0D2B5C";
  }

  setTimeout(resizeCanvas, 50);

  function position(event) {
    const rect = canvas.getBoundingClientRect();
    const point = event.touches ? event.touches[0] : event;
    return [point.clientX - rect.left, point.clientY - rect.top];
  }

  const startDrawing = event => {
    drawing = true;
    const [x, y] = position(event);
    context.beginPath();
    context.moveTo(x, y);
    event.preventDefault();
  };

  const draw = event => {
    if (!drawing) return;
    const [x, y] = position(event);
    context.lineTo(x, y);
    context.stroke();
    event.preventDefault();
  };

  const stopDrawing = () => { drawing = false; };

  canvas.addEventListener("mousedown", startDrawing);
  canvas.addEventListener("mousemove", draw);
  canvas.addEventListener("mouseup", stopDrawing);
  canvas.addEventListener("mouseleave", stopDrawing);
  canvas.addEventListener("touchstart", startDrawing, { passive: false });
  canvas.addEventListener("touchmove", draw, { passive: false });
  canvas.addEventListener("touchend", stopDrawing);

  $("clearSig").onclick = () => {
    context.clearRect(0, 0, canvas.width, canvas.height);
  };

  $("cPresence").onchange = () => {
    const present = $("cPresence").value === "yes";
    $("recipientFields").classList.toggle("hidden", !present);
    $("photoFields").classList.toggle("hidden", present);
  };

  $("completeForm").onsubmit = async event => {
    event.preventDefault();
    const button = event.submitter;

    try {
      const present = $("cPresence").value === "yes";
      const receivedLiters = Number($("cLiters").value);

      if (!Number.isFinite(receivedLiters) || receivedLiters < 1) {
        return toast("Informe a quantidade entregue.");
      }

      if (present && $("cPin").value.trim() !== String(delivery.confirmationPin || "")) {
        return toast("PIN de confirmação incorreto.");
      }

      if (present && isBlankCanvas(canvas)) {
        return toast("Faça a assinatura do beneficiário no quadro.");
      }

      if (!present && !$("cPhoto").files[0]) {
        return toast("A foto é obrigatória quando não há ninguém no local.");
      }

      if (button) {
        button.disabled = true;
        button.textContent = "Gravando...";
      }

      let photoUrl = null;
      let signatureData = null;

      if (present) {
        signatureData = canvas.toDataURL("image/png");
      } else {
        const file = $("cPhoto").files[0];
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const path = `delivery-proof/${id}/${Date.now()}-${safeName}`;

        const uploaded = await uploadBytes(ref(storage, path), file, {
          contentType: file.type
        });

        photoUrl = await getDownloadURL(uploaded.ref);
      }

      await updateDoc(doc(db, "deliveries", id), {
        status: present ? "awaiting_confirmation" : "absent",
        receivedLiters,
        recipientPresent: present,
        signatureData,
        photoUrl,
        recipientConfirmed: false,
        note: $("cNote").value.trim(),
        completedAt: serverTimestamp(),
        completedBy: state.user.uid,
        updatedAt: serverTimestamp(),
        updatedBy: state.user.uid
      });

      closeModal();
      toast(present ? "Fornecimento registrado! Aguardando confirmação do beneficiário." : "Registrado como 'Ninguém no local'.");
      await renderDriver();
    } catch (error) {
      console.error("Erro ao registrar fornecimento:", error);
      toast("Não foi possível salvar o registro.");
      if (button) {
        button.disabled = false;
        button.textContent = "Concluir registro";
      }
    }
  };
}

function isBlankCanvas(canvas) {
  const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] > 0) return false;
  }
  return true;
}

/* =========================================================
   BENEFICIÁRIO
========================================================= */

async function renderRecipient() {
  let list = [];

  try {
    const snapshot = await getDocs(
      query(
        collection(db, "deliveries"),
        where("recipientUid", "==", state.user.uid),
        limit(50)
      )
    );

    list = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
  } catch (error) {
    console.warn("Erro ao buscar por UID:", error);
  }

  if (!list.length && state.profile?.phone) {
    try {
      const snapshot = await getDocs(
        query(
          collection(db, "deliveries"),
          where("recipientPhone", "==", state.profile.phone),
          limit(50)
        )
      );

      list = snapshot.docs
        .map(item => ({ id: item.id, ...item.data() }))
        .filter(item => !item.recipientUid || item.recipientUid === state.user.uid);
    } catch (error) {
      console.warn("Erro ao buscar entregas complementares:", error);
    }
  }

  list.sort((a, b) =>
    String(b.scheduledDate || "").localeCompare(String(a.scheduledDate || ""))
  );

  $("recipientPanel").innerHTML = `
    <div class="card">
      <div class="panel-title">
        <h2>Meu abastecimento</h2>
      </div>

      <div class="notice">
        Confira seu histórico de fornecimento de água. Quando houver uma entrega pendente de confirmação, verifique a quantidade e confirme abaixo.
      </div>

      <div class="grid" style="margin-top:14px">
        ${
          list.map(recipientCard).join("") ||
          "<p class='small'>Nenhum fornecimento registrado até o momento.</p>"
        }
      </div>
    </div>
  `;

  document.querySelectorAll("[data-confirm-recipient]").forEach(button => {
    button.onclick = () => confirmRecipientDelivery(button.dataset.confirmRecipient);
  });
}

function recipientCard(delivery) {
  const canConfirm =
    delivery.status === "awaiting_confirmation" &&
    delivery.recipientUid === state.user.uid &&
    delivery.recipientPresent === true;

  return `
    <div class="item">
      <div class="row">
        <h3>${esc(dateOnly(delivery.scheduledDate))}</h3>
        <span class="pill ${esc(delivery.status)}">
          ${statusLabel(delivery.status)}
        </span>
      </div>

      <p><b>Quantidade programada:</b> ${esc(delivery.plannedLiters ?? "—")} L</p>
      <p><b>Quantidade entregue:</b> ${delivery.receivedLiters != null ? `${esc(delivery.receivedLiters)} L` : "Pendente"}</p>
      <p><b>Endereço atendido:</b> ${esc(delivery.address || "—")}</p>

      ${
        delivery.status === "completed" && delivery.recipientConfirmedAt
          ? `<div class="notice" style="margin-top:10px">Confirmado em: ${fmtDate(delivery.recipientConfirmedAt)}</div>`
          : ""
      }

      ${
        canConfirm
          ? `
            <div class="actions" style="margin-top:12px">
              <button class="primary" data-confirm-recipient="${esc(delivery.id)}" style="width:100%">
                ✅ Confirmar recebimento da água
              </button>
            </div>
          `
          : ""
      }
    </div>
  `;
}

async function confirmRecipientDelivery(id) {
  try {
    const snapshot = await getDoc(doc(db, "deliveries", id));
    if (!snapshot.exists()) return toast("Entrega não encontrada.");

    const delivery = snapshot.data();

    if (delivery.recipientUid !== state.user.uid || delivery.status !== "awaiting_confirmation") {
      return toast("Entrega indisponível para confirmação.");
    }

    openModal(`
      <h2>Confirmar recebimento de água</h2>

      <div class="notice">
        <b>Data:</b> ${esc(dateOnly(delivery.scheduledDate))}<br>
        <b>Quantidade informada:</b> ${esc(delivery.receivedLiters ?? "—")} litros<br>
        <b>Local:</b> ${esc(delivery.address || "—")}
      </div>

      <p style="margin:16px 0">Você confirma que o caminhão-pipa realizou este abastecimento no seu imóvel?</p>

      <div class="actions">
        <button type="button" class="secondary" id="cancelRecipientConfirmation">Voltar</button>
        <button type="button" class="primary" id="approveRecipientConfirmation">Confirmar</button>
      </div>
    `);

    $("cancelRecipientConfirmation").onclick = closeModal;

    $("approveRecipientConfirmation").onclick = async () => {
      const button = $("approveRecipientConfirmation");

      try {
        button.disabled = true;
        button.textContent = "Confirmando...";

        await updateDoc(doc(db, "deliveries", id), {
          status: "completed",
          recipientConfirmed: true,
          recipientConfirmedAt: serverTimestamp(),
          recipientConfirmedBy: state.user.uid,
          updatedAt: serverTimestamp(),
          updatedBy: state.user.uid
        });

        closeModal();
        toast("Abastecimento confirmado com sucesso!");
        await renderRecipient();
      } catch (error) {
        console.error("Erro na confirmação:", error);
        toast("Não foi possível confirmar o recebimento.");
      }
    };
  } catch (error) {
    console.error("Erro ao abrir confirmação:", error);
  }
}
