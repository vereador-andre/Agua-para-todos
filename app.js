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
  console.error(
    "Erro ao inicializar Firebase secundário:",
    error
  );
}

/* =========================================================
   ACESSO POR TELEFONE DO BENEFICIÁRIO
========================================================= */

function normalizePhone(value) {
  let digits = String(value || "").replace(/\D/g, "");

  if (
    (digits.length === 12 || digits.length === 13) &&
    digits.startsWith("55")
  ) {
    digits = digits.slice(2);
  }

  return digits;
}

function recipientAuthEmail(phone) {
  const digits = normalizePhone(phone);

  if (digits.length < 10 || digits.length > 11) {
    throw new Error(
      "Informe um telefone brasileiro válido, com DDD."
    );
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
  $("loginEmail").inputMode = "text";
  $("loginEmail").autocomplete = "username";
  $("loginEmail").placeholder =
    "E-mail ou telefone do beneficiário";
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
      const request = indexedDB.open(
        OFFLINE_DB_NAME,
        OFFLINE_DB_VERSION
      );

      request.onupgradeneeded = () => {
        const localDb = request.result;

        if (
          !localDb.objectStoreNames.contains(
            DELIVERY_CACHE_STORE
          )
        ) {
          localDb.createObjectStore(
            DELIVERY_CACHE_STORE,
            { keyPath: "id" }
          );
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
    if (
      local[field] &&
      typeof local[field].toDate === "function"
    ) {
      local[field] = local[field]
        .toDate()
        .toISOString();
    }
  });

  return local;
}

async function saveDriverDeliveriesToCache(deliveries) {
  try {
    const localDb = await openOfflineDB();

    await new Promise((resolve, reject) => {
      const tx = localDb.transaction(
        DELIVERY_CACHE_STORE,
        "readwrite"
      );

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
    console.error(
      "Erro ao salvar entregas no cache offline:",
      error
    );
  }
}

async function getCachedDriverDeliveries(driverUid) {
  try {
    const localDb = await openOfflineDB();

    const result = await new Promise((resolve, reject) => {
      const tx = localDb.transaction(
        DELIVERY_CACHE_STORE,
        "readonly"
      );

      const request = tx
        .objectStore(DELIVERY_CACHE_STORE)
        .getAll();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    localDb.close();

    return result
      .filter(delivery => delivery.driverUid === driverUid)
      .sort((a, b) =>
        String(a.scheduledDate || "").localeCompare(
          String(b.scheduledDate || "")
        )
      );
  } catch (error) {
    console.error(
      "Erro ao carregar entregas do cache offline:",
      error
    );

    return [];
  }
}

/* =========================================================
   PERFIL OFFLINE
========================================================= */

function saveProfileToCache(userUid, profile) {
  try {
    localStorage.setItem(
      `aguaParaTodosProfile_${userUid}`,
      JSON.stringify(profile)
    );
  } catch (error) {
    console.error("Erro ao salvar perfil local:", error);
  }
}

function getProfileFromCache(userUid) {
  try {
    const saved = localStorage.getItem(
      `aguaParaTodosProfile_${userUid}`
    );

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

  const date = timestamp.toDate
    ? timestamp.toDate()
    : new Date(timestamp);

  return date.toLocaleString("pt-BR");
}

function dateOnly(value) {
  if (!value) return "—";

  return new Date(value + "T12:00:00")
    .toLocaleDateString("pt-BR");
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
          error.message &&
          error.message.includes("telefone brasileiro válido")
            ? error.message
            : friendlyAuthError(error);
      }
    }
  };
}

function friendlyAuthError(error) {
  const messages = {
    "auth/invalid-credential":
      "Telefone/e-mail ou senha inválidos.",
    "auth/user-not-found":
      "Usuário não encontrado.",
    "auth/wrong-password":
      "Senha incorreta.",
    "auth/too-many-requests":
      "Muitas tentativas. Aguarde alguns minutos.",
    "auth/email-already-in-use":
      "Este acesso já está cadastrado.",
    "auth/invalid-email":
      "O telefone ou e-mail informado é inválido.",
    "auth/weak-password":
      "A senha informada é muito fraca.",
    "auth/network-request-failed":
      "Falha de conexão. Verifique a internet."
  };

  return messages[error.code] ||
    "Não foi possível entrar. Verifique os dados e tente novamente.";
}

/* =========================================================
   AUTENTICAÇÃO E CARREGAMENTO DO PERFIL
========================================================= */

onAuthStateChanged(auth, async user => {
  if (!user) {
    state.user = null;
    state.profile = null;

    if ($("loginView")) {
      $("loginView").classList.remove("hidden");
    }

    if ($("appView")) {
      $("appView").classList.add("hidden");
    }

    if ($("logoutBtn")) {
      $("logoutBtn").classList.add("hidden");
    }

    return;
  }

  state.user = user;

  if ($("loginView")) $("loginView").classList.add("hidden");
  if ($("appView")) $("appView").classList.remove("hidden");
  if ($("logoutBtn")) $("logoutBtn").classList.remove("hidden");

  updateConnectionStatus();

  try {
    let profile = null;

    try {
      const snapshot = await getDoc(
        doc(db, "users", user.uid)
      );

      if (snapshot.exists()) {
        profile = {
          id: snapshot.id,
          ...snapshot.data()
        };

        saveProfileToCache(user.uid, profile);
      }
    } catch (firebaseError) {
      console.warn(
        "Não foi possível carregar o perfil do Firebase.",
        firebaseError
      );
    }

    if (!profile) {
      profile = getProfileFromCache(user.uid);
    }

    if (!profile) {
      toast(
        "Usuário autenticado, mas sem perfil cadastrado."
      );
      return;
    }

    if (profile.active === false) {
      toast(
        "Este usuário está inativo. Procure a administração."
      );

      await signOut(auth);
      return;
    }

    state.profile = profile;

    if ($("userName")) {
      $("userName").textContent =
        profile.name || user.email || "Usuário";
    }

    if ($("userRole")) {
      $("userRole").textContent = roleLabel(profile.role);
    }

    await renderByRole();
  } catch (error) {
    console.error(
      "Erro ao carregar perfil/aplicativo:",
      error
    );

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
  [
    "adminPanel",
    "driverPanel",
    "recipientPanel"
  ].forEach(id => {
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
    if ($("recipientPanel")) {
      $("recipientPanel").classList.remove("hidden");
    }

    await renderRecipient();
  }
}

/* =========================================================
   ADMIN
========================================================= */

async function renderAdmin() {
  try {
    const householdSnapshot = await getDocs(
      collection(db, "households")
    );

    state.households = householdSnapshot.docs
      .map(item => ({
        id: item.id,
        ...item.data()
      }))
      .sort((a, b) =>
        String(a.name || "").localeCompare(
          String(b.name || ""),
          "pt-BR"
        )
      );

    const deliverySnapshot = await getDocs(
      query(
        collection(db, "deliveries"),
        limit(100)
      )
    );

    state.deliveries = deliverySnapshot.docs
      .map(item => ({
        id: item.id,
        ...item.data()
      }))
      .sort((a, b) =>
        String(b.scheduledDate || "").localeCompare(
          String(a.scheduledDate || "")
        )
      );

    await loadDriversList();
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

async function loadDriversList() {
  try {
    const driverSnapshot = await getDocs(
      query(
        collection(db, "users"),
        where("role", "==", "driver")
      )
    );

    state.drivers = driverSnapshot.docs.map(item => ({
      id: item.id,
      ...item.data()
    }));
  } catch (e) {
    console.error("Erro ao carregar motoristas:", e);
    state.drivers = [];
  }
}

/* =========================================================
   MENU ADMINISTRATIVO
========================================================= */

function renderAdminMenu() {
  const pending = state.deliveries.filter(
    item => item.status === "scheduled"
  ).length;

  const completed = state.deliveries.filter(
    item => item.status === "completed"
  ).length;

  const awaiting = state.deliveries.filter(
    item => item.status === "awaiting_confirmation"
  ).length;

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
        <div class="stat"><b>${awaiting}</b> aguardando confirmação</div>
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

  if (section === "scheduled") {
    return renderAdminDeliveries("scheduled", "Entregas programadas");
  }

  if (section === "awaiting") {
    return renderAdminDeliveries(
      "awaiting_confirmation",
      "Aguardando confirmação"
    );
  }

  if (section === "completed") {
    return renderAdminDeliveries("completed", "Entregas concluídas");
  }

  if (section === "history") {
    return renderAdminDeliveries("all", "Histórico de entregas");
  }
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
    button.onclick = () =>
      showEditHouseholdForm(button.dataset.editHousehold);
  });
}

function householdCard(household) {
  const accessText = household.recipientUid
    ? "Acesso criado"
    : "Sem acesso";

  return `
    <div class="item">
      <div class="row">
        <h3>${esc(household.name || "Sem nome")}</h3>

        <span class="pill ${
          household.active === false ? "cancelled" : "completed"
        }">
          ${household.active === false ? "Inativa" : "Ativa"}
        </span>
      </div>

      <p>
        <b>Telefone:</b> ${esc(household.phone || "—")}
        ${
          household.cpf
            ? ` · <b>CPF:</b> ${esc(household.cpf)}`
            : ""
        }
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
        <button
          class="secondary"
          data-edit-household="${esc(household.id)}">
          ✏️ Editar cadastro
        </button>
      </div>
    </div>
  `;
}

function showHouseholdForm() {
  openModal(`
    <h2>Nova família / imóvel</h2>

    <form id="householdForm">
      <label>
        Nome do responsável
        <input id="hName" autocomplete="name" required>
      </label>

      <label>
        CPF (opcional)
        <input id="hCpf" inputmode="numeric">
      </label>

      <label>
        Telefone do beneficiário
        <input id="hPhone" type="tel" autocomplete="tel" required>
      </label>

      <div class="notice">
        <b>Acesso do beneficiário</b><br>
        O beneficiário entrará no aplicativo usando este telefone
        e a senha inicial definida abaixo. Não é necessário e-mail pessoal.
      </div>

      <label>
        Senha inicial
        <input
          id="hPassword"
          type="password"
          minlength="6"
          autocomplete="new-password"
          required>
      </label>

      <label>
        Confirmar senha
        <input
          id="hPasswordConfirm"
          type="password"
          minlength="6"
          autocomplete="new-password"
          required>
      </label>

      <label>
        Comunidade / zona rural
        <input id="hCommunity" required>
      </label>

      <label>
        Endereço / referência
        <input id="hAddress" required>
      </label>

      <label>
        Quantidade de pessoas
        <input id="hPeople" type="number" min="1" required>
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
        <input id="hLiters" type="number" min="1" required>
      </label>

      <div class="actions">
        <button type="button" class="secondary" id="cancelNewHousehold">
          Cancelar
        </button>

        <button class="primary" id="saveHousehold">
          Salvar família
        </button>
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

    if (password.length < 6) {
      return toast("A senha precisa ter pelo menos 6 caracteres.");
    }

    if (password !== passwordConfirm) {
      return toast("As senhas não conferem.");
    }

    if (!community) return toast("Informe a comunidade ou zona rural.");
    if (!address) return toast("Informe o endereço ou referência.");

    if (!secondaryAuth) {
      return toast("Não foi possível preparar o cadastro do beneficiário.");
    }

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

      const householdRef = await addDoc(
        collection(db, "households"),
        {
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
        }
      );

      createdHouseholdId = householdRef.id;

      await setDoc(
        doc(db, "users", createdUser.uid),
        {
          name,
          phone,
          authEmail,
          role: "recipient",
          active: true,
          householdId: createdHouseholdId,
          createdAt: serverTimestamp(),
          createdBy: state.user.uid
        }
      );

      createdUserProfile = true;

      try {
        await signOutSecondary(secondaryAuth);
      } catch (_) {}

      closeModal();
      toast("Família e acesso do beneficiário cadastrados com sucesso.");
      await renderAdmin();
    } catch (error) {
      console.error("Erro ao cadastrar família:", error);

      if (createdHouseholdId) {
        try { await deleteDoc(doc(db, "households", createdHouseholdId)); } catch (_) {}
      }
      if (createdUserProfile && createdUser) {
        try { await deleteDoc(doc(db, "users", createdUser.uid)); } catch (_) {}
      }
      if (createdUser) {
        try { await deleteUser(createdUser); } catch (_) {}
      }
      try { await signOutSecondary(secondaryAuth); } catch (_) {}

      if (error.code === "auth/email-already-in-use") {
        toast("Já existe um acesso cadastrado com esse telefone.");
      } else {
        toast("Não foi possível cadastrar a família. Verifique os dados.");
      }
    } finally {
      button.disabled = false;
      button.textContent = "Salvar família";
    }
  };
}

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
   MOTORISTAS E USUÁRIOS
========================================================= */

function renderAdminDrivers() {
  const content = $("adminContent");
  if (!content) return;

  content.innerHTML = `
    <div class="card">
      <div class="panel-title">
        <div>
          <h2>Motoristas</h2>
          <p class="small">${state.drivers.length} motorista(s) cadastrado(s).</p>
        </div>
        <div class="actions">
          <button class="primary" id="adminNewDriver">+ Cadastrar motorista</button>
        </div>
      </div>

      <div class="grid">
        ${
          state.drivers.map(driver => `
            <div class="item">
              <div class="row">
                <h3>${esc(driver.name || "Sem nome")}</h3>
                <span class="pill ${driver.active === false ? "cancelled" : "completed"}">
                  ${driver.active === false ? "Inativo" : "Ativo"}
                </span>
              </div>
              <p><b>E-mail/Login:</b> ${esc(driver.email || "—")}</p>
              <p><b>Telefone:</b> ${esc(driver.phone || "—")}</p>
            </div>
          `).join("") || "<p class='small'>Nenhum motorista cadastrado.</p>"
        }
      </div>
    </div>
  `;

  $("adminNewDriver").onclick = showDriverForm;
}

function showDriverForm() {
  openModal(`
    <h2>Novo motorista</h2>
    <form id="driverForm">
      <label>Nome completo <input id="dName" required></label>
      <label>E-mail de acesso <input id="dEmail" type="email" required></label>
      <label>Telefone <input id="dPhone" type="tel" required></label>
      <label>Senha inicial <input id="dPassword" type="password" minlength="6" required></label>
      <div class="actions">
        <button type="button" class="secondary" id="cancelDriver">Cancelar</button>
        <button type="submit" class="primary">Salvar motorista</button>
      </div>
    </form>
  `);

  $("cancelDriver").onclick = closeModal;

  $("driverForm").onsubmit = async event => {
    event.preventDefault();
    const name = $("dName").value.trim();
    const email = $("dEmail").value.trim().toLowerCase();
    const phone = $("dPhone").value.trim();
    const password = $("dPassword").value;

    try {
      const credential = await createUserWithEmailAndPassword(secondaryAuth, email, password);
      await setDoc(doc(db, "users", credential.user.uid), {
        name,
        email,
        phone,
        role: "driver",
        active: true,
        createdAt: serverTimestamp()
      });
      try { await signOutSecondary(secondaryAuth); } catch (_) {}
      closeModal();
      toast("Motorista cadastrado com sucesso.");
      await renderAdmin();
    } catch (e) {
      console.error("Erro ao cadastrar motorista:", e);
      toast("Erro ao cadastrar motorista. Verifique os dados.");
    }
  };
}

function renderAdminUsers() {
  const content = $("adminContent");
  if (!content) return;
  content.innerHTML = `<div class="card"><h2>Usuários do Sistema</h2><p class="small">Gerenciamento completo disponível no painel de administração geral.</p></div>`;
}

/* =========================================================
   AGENDAMENTO DE ENTREGAS
========================================================= */

function showDeliveryForm() {
  const content = $("adminContent");
  if (!content) return;

  content.innerHTML = `
    <div class="card">
      <h2>Programar nova entrega</h2>
      <form id="deliveryForm">
        <label>
          Família / Beneficiário
          <select id="delHousehold" required>
            <option value="">Selecione a família...</option>
            ${state.households.map(h => `<option value="${h.id}">${esc(h.name)} - ${esc(h.community)} (${h.defaultLiters || 5000}L)</option>`).join("")}
          </select>
        </label>

        <label>
          Motorista responsável
          <select id="delDriver" required>
            <option value="">Selecione o motorista...</option>
            ${state.drivers.map(d => `<option value="${d.id}">${esc(d.name)}</option>`).join("")}
          </select>
        </label>

        <label>
          Data prevista
          <input id="delDate" type="date" required>
        </label>

        <label>
          Volume programado (Litros)
          <input id="delLiters" type="number" min="1" value="5000" required>
        </label>

        <div class="actions">
          <button type="submit" class="primary">Programar entrega</button>
        </div>
      </form>
    </div>
  `;

  $("delHousehold").onchange = e => {
    const selected = state.households.find(h => h.id === e.target.value);
    if (selected && selected.defaultLiters) {
      $("delLiters").value = selected.defaultLiters;
    }
  };

  $("deliveryForm").onsubmit = async event => {
    event.preventDefault();
    const householdId = $("delHousehold").value;
    const driverUid = $("delDriver").value;
    const scheduledDate = $("delDate").value;
    const plannedLiters = Number($("delLiters").value);

    const household = state.households.find(h => h.id === householdId);
    const driver = state.drivers.find(d => d.id === driverUid);

    if (!household || !driver) return toast("Selecione a família e o motorista.");

    try {
      await addDoc(collection(db, "deliveries"), {
        householdId,
        recipientName: household.name,
        community: household.community,
        address: household.address,
        driverUid,
        driverName: driver.name,
        scheduledDate,
        plannedLiters,
        status: "scheduled",
        createdAt: serverTimestamp(),
        createdBy: state.user.uid
      });

      toast("Entrega programada com sucesso!");
      await renderAdmin();
    } catch (e) {
      console.error("Erro ao programar entrega:", e);
      toast("Erro ao programar entrega.");
    }
  };
}

function renderAdminDeliveries(filterStatus, title) {
  const content = $("adminContent");
  if (!content) return;

  const list = state.deliveries.filter(d => filterStatus === "all" || d.status === filterStatus);

  content.innerHTML = `
    <div class="card">
      <h2>${title} (${list.length})</h2>
      <div class="grid">
        ${list.map(d => `
          <div class="item">
            <div class="row">
              <h3>${esc(d.recipientName)}</h3>
              <span class="pill ${d.status}">${d.status}</span>
            </div>
            <p><b>Comunidade:</b> ${esc(d.community)}</p>
            <p><b>Motorista:</b> ${esc(d.driverName || "—")} · <b>Data:</b> ${dateOnly(d.scheduledDate)}</p>
            <p><b>Volume:</b> ${d.plannedLiters} L</p>
          </div>
        `).join("") || "<p class='small'>Nenhuma entrega encontrada.</p>"}
      </div>
    </div>
  `;
}

/* =========================================================
   PAINEL DO MOTORISTA
========================================================= */

async function renderDriver() {
  const panel = $("driverPanel");
  if (!panel) return;

  panel.innerHTML = `
    <div class="card">
      <h2>Minhas entregas</h2>
      <div id="driverDeliveriesList"><p class="small">Carregando...</p></div>
    </div>
  `;

  try {
    const snap = await getDocs(
      query(collection(db, "deliveries"), where("driverUid", "==", state.user.uid))
    );

    const deliveries = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    await saveDriverDeliveriesToCache(deliveries);

    const container = $("driverDeliveriesList");
    if (!container) return;

    container.innerHTML = deliveries.map(d => `
      <div class="item">
        <div class="row">
          <h3>${esc(d.recipientName)}</h3>
          <span class="pill ${d.status}">${d.status}</span>
        </div>
        <p><b>Data:</b> ${dateOnly(d.scheduledDate)} · <b>Volume:</b> ${d.plannedLiters} L</p>
        ${d.status === "scheduled" ? `<button class="primary" onclick="window.startDelivery('${d.id}')">Realizar entrega</button>` : ""}
      </div>
    `).join("") || "<p class='small'>Nenhuma entrega atribuída.</p>";
  } catch (e) {
    const cached = await getCachedDriverDeliveries(state.user.uid);
    const container = $("driverDeliveriesList");
    if (container) {
      container.innerHTML = `<p class="notice">Exibindo dados offline (${cached.length} entregas).</p>` + 
        cached.map(d => `<div class="item"><h3>${esc(d.recipientName)}</h3><p>Data: ${dateOnly(d.scheduledDate)}</p></div>`).join("");
    }
  }
}

window.startDelivery = function(deliveryId) {
  toast("Iniciando registro de entrega...");
};

/* =========================================================
   PAINEL DO BENEFICIÁRIO
========================================================= */

async function renderRecipient() {
  const panel = $("recipientPanel");
  if (!panel) return;

  panel.innerHTML = `
    <div class="card">
      <h2>Minhas Entregas de Água</h2>
      <div id="recipientDeliveriesList"><p class="small">Carregando...</p></div>
    </div>
  `;

  try {
    const householdId = state.profile.householdId;
    if (!householdId) {
      $("recipientDeliveriesList").innerHTML = "<p class='small'>Nenhuma família vinculada ao seu login.</p>";
      return;
    }

    const snap = await getDocs(
      query(collection(db, "deliveries"), where("householdId", "==", householdId))
    );

    const deliveries = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    $("recipientDeliveriesList").innerHTML = deliveries.map(d => `
      <div class="item">
        <div class="row">
          <h3>Entrega em ${dateOnly(d.scheduledDate)}</h3>
          <span class="pill ${d.status}">${d.status}</span>
        </div>
        <p><b>Volume:</b> ${d.plannedLiters} L · <b>Motorista:</b> ${esc(d.driverName || "—")}</p>
      </div>
    `).join("") || "<p class='small'>Nenhum histórico de entrega encontrado.</p>";
  } catch (e) {
    console.error("Erro ao carregar entregas do beneficiário:", e);
  }
}
