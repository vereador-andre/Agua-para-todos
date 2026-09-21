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

const $ = (id) => document.getElementById(id);

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
   USADO PARA CRIAR MOTORISTAS E BENEFICIÁRIOS
   SEM DESCONECTAR O ADMINISTRADOR
========================================================= */

let secondaryApp = null;
let secondaryAuth = null;

try {

  secondaryApp = initializeApp(
    firebaseConfig,
    "DriverRegistrationApp"
  );

  secondaryAuth = getAuth(
    secondaryApp
  );

} catch (error) {

  console.error(
    "Erro ao inicializar Firebase secundário:",
    error
  );

}


/* =========================================================
   CACHE OFFLINE
========================================================= */

const OFFLINE_DB_NAME =
  "agua-para-todos-offline";

const OFFLINE_DB_VERSION = 1;

const DELIVERY_CACHE_STORE =
  "deliveryCache";


function openOfflineDB() {

  return new Promise((resolve, reject) => {

    try {

      const request =
        indexedDB.open(
          OFFLINE_DB_NAME,
          OFFLINE_DB_VERSION
        );

      request.onupgradeneeded = () => {

        const localDb =
          request.result;

        if (
          !localDb.objectStoreNames.contains(
            DELIVERY_CACHE_STORE
          )
        ) {

          localDb.createObjectStore(
            DELIVERY_CACHE_STORE,
            {
              keyPath: "id"
            }
          );

        }

      };

      request.onsuccess = () => {

        resolve(
          request.result
        );

      };

      request.onerror = () => {

        reject(
          request.error
        );

      };

    } catch (error) {

      reject(error);

    }

  });

}


function prepareDeliveryForCache(d) {

  const local = {
    ...d
  };

  if (
    local.createdAt &&
    typeof local.createdAt.toDate === "function"
  ) {

    local.createdAt =
      local.createdAt
        .toDate()
        .toISOString();

  }

  if (
    local.completedAt &&
    typeof local.completedAt.toDate === "function"
  ) {

    local.completedAt =
      local.completedAt
        .toDate()
        .toISOString();

  }

  if (
    local.updatedAt &&
    typeof local.updatedAt.toDate === "function"
  ) {

    local.updatedAt =
      local.updatedAt
        .toDate()
        .toISOString();

  }

  return local;

}


async function saveDriverDeliveriesToCache(
  deliveries
) {

  try {

    const localDb =
      await openOfflineDB();

    await new Promise(
      (resolve, reject) => {

        const tx =
          localDb.transaction(
            DELIVERY_CACHE_STORE,
            "readwrite"
          );

        const store =
          tx.objectStore(
            DELIVERY_CACHE_STORE
          );

        deliveries.forEach(
          delivery => {

            store.put(
              prepareDeliveryForCache(
                delivery
              )
            );

          }
        );

        tx.oncomplete = () => {

          resolve();

        };

        tx.onerror = () => {

          reject(
            tx.error
          );

        };

        tx.onabort = () => {

          reject(
            tx.error
          );

        };

      }
    );

    localDb.close();

  } catch (error) {

    console.error(
      "Erro ao salvar entregas no cache offline:",
      error
    );

  }

}


async function getCachedDriverDeliveries(
  driverUid
) {

  try {

    const localDb =
      await openOfflineDB();

    const result =
      await new Promise(
        (resolve, reject) => {

          const tx =
            localDb.transaction(
              DELIVERY_CACHE_STORE,
              "readonly"
            );

          const store =
            tx.objectStore(
              DELIVERY_CACHE_STORE
            );

          const request =
            store.getAll();

          request.onsuccess = () => {

            resolve(
              request.result
            );

          };

          request.onerror = () => {

            reject(
              request.error
            );

          };

        }
      );

    localDb.close();

    return result
      .filter(
        delivery =>
          delivery.driverUid ===
          driverUid
      )
      .sort(
        (a, b) =>
          String(
            a.scheduledDate || ""
          ).localeCompare(
            String(
              b.scheduledDate || ""
            )
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

function saveProfileToCache(
  userUid,
  profile
) {

  try {

    localStorage.setItem(
      `aguaParaTodosProfile_${userUid}`,
      JSON.stringify(profile)
    );

  } catch (error) {

    console.error(
      "Erro ao salvar perfil local:",
      error
    );

  }

}


function getProfileFromCache(
  userUid
) {

  try {

    const saved =
      localStorage.getItem(
        `aguaParaTodosProfile_${userUid}`
      );

    if (!saved) {

      return null;

    }

    return JSON.parse(saved);

  } catch (error) {

    console.error(
      "Erro ao recuperar perfil local:",
      error
    );

    return null;

  }

}


/* =========================================================
   CONEXÃO
========================================================= */

function updateConnectionStatus() {

  const el =
    $("connectionStatus");

  if (!el) return;

  if (navigator.onLine) {

    el.textContent =
      "Online";

    el.classList.add(
      "ok"
    );

  } else {

    el.textContent =
      "Sem internet";

    el.classList.remove(
      "ok"
    );

  }

}

window.addEventListener(
  "online",
  updateConnectionStatus
);

window.addEventListener(
  "offline",
  updateConnectionStatus
);

updateConnectionStatus();


/* =========================================================
   EVENTOS PRINCIPAIS
========================================================= */

if ($("logoutBtn")) {

  $("logoutBtn").onclick =
    () => signOut(auth);

}

if ($("closeModal")) {

  $("closeModal").onclick =
    closeModal;

}

if ($("modal")) {

  $("modal").onclick =
    e => {

      if (
        e.target.id ===
        "modal"
      ) {

        closeModal();

      }

    };

}


/* =========================================================
   FUNÇÕES GERAIS
========================================================= */

function toast(msg) {

  if (!$("toast")) return;

  $("toast").textContent =
    msg;

  $("toast").classList.add(
    "show"
  );

  setTimeout(() => {

    $("toast").classList.remove(
      "show"
    );

  }, 3500);

}


function openModal(html) {

  $("modalContent").innerHTML =
    html;

  $("modal").classList.remove(
    "hidden"
  );

}


function closeModal() {

  $("modal").classList.add(
    "hidden"
  );

  $("modalContent").innerHTML =
    "";

}


function esc(v = "") {

  return String(v).replace(
    /[&<>"']/g,
    m =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
      }[m])
  );

}


function fmtDate(ts) {

  if (!ts) return "—";

  const d =
    ts.toDate
      ? ts.toDate()
      : new Date(ts);

  return d.toLocaleString(
    "pt-BR"
  );

}


function dateOnly(v) {

  if (!v) return "—";

  return new Date(
    v + "T12:00:00"
  ).toLocaleDateString(
    "pt-BR"
  );

}


/* =========================================================
   LOGIN
========================================================= */

if ($("loginForm")) {

  $("loginForm").onsubmit =
    async e => {

      e.preventDefault();

      $("loginMsg").textContent =
        "";

      try {

        await signInWithEmailAndPassword(
          auth,
          $("loginEmail")
            .value
            .trim(),
          $("loginPassword")
            .value
        );

      } catch (err) {

        console.error(
          "Erro no login:",
          err
        );

        $("loginMsg").textContent =
          friendlyAuthError(err);

      }

    };

}


function friendlyAuthError(err) {

  const m = {

    "auth/invalid-credential":
      "E-mail ou senha inválidos.",

    "auth/user-not-found":
      "Usuário não encontrado.",

    "auth/wrong-password":
      "Senha incorreta.",

    "auth/too-many-requests":
      "Muitas tentativas. Aguarde alguns minutos.",

    "auth/email-already-in-use":
      "Este e-mail já está cadastrado.",

    "auth/invalid-email":
      "O e-mail informado é inválido.",

    "auth/weak-password":
      "A senha informada é muito fraca."

  };

  return m[err.code] ||
    "Não foi possível entrar. Verifique os dados.";

}


/* =========================================================
   AUTENTICAÇÃO
========================================================= */

onAuthStateChanged(
  auth,
  async user => {

    if (!user) {

      state.user = null;
      state.profile = null;

      if ($("loginView"))
        $("loginView")
          .classList
          .remove("hidden");

      if ($("appView"))
        $("appView")
          .classList
          .add("hidden");

      if ($("logoutBtn"))
        $("logoutBtn")
          .classList
          .add("hidden");

      return;

    }

    state.user =
      user;

    if ($("loginView"))
      $("loginView")
        .classList
        .add("hidden");

    if ($("appView"))
      $("appView")
        .classList
        .remove("hidden");

    if ($("logoutBtn"))
      $("logoutBtn")
        .classList
        .remove("hidden");

    updateConnectionStatus();

    try {

      let profile = null;

      try {

        const p =
          await getDoc(
            doc(
              db,
              "users",
              user.uid
            )
          );

        if (p.exists()) {

          profile = {
            id: p.id,
            ...p.data()
          };

          saveProfileToCache(
            user.uid,
            profile
          );

        }

      } catch (firebaseError) {

        console.warn(
          "Não foi possível carregar o perfil do Firebase.",
          firebaseError
        );

      }

      if (!profile) {

        profile =
          getProfileFromCache(
            user.uid
          );

      }

      if (!profile) {

        toast(
          "Usuário autenticado, mas sem perfil cadastrado."
        );

        return;

      }

      state.profile =
        profile;

      if ($("userName")) {

        $("userName").textContent =
          state.profile.name ||
          user.email;

      }

      if ($("userRole")) {

        $("userRole").textContent =
          roleLabel(
            state.profile.role
          );

      }

      await renderByRole();

    } catch (e) {

      console.error(
        "ERRO AO CARREGAR PERFIL/APLICATIVO:",
        e
      );

      toast(
        "Erro ao carregar seu perfil."
      );

    }

  }
);


/* =========================================================
   PERFIS
========================================================= */

function roleLabel(r) {

  return ({
    admin: "Administrador",
    driver: "Motorista",
    recipient: "Beneficiário"
  })[r] || r || "Usuário";

}


async function renderByRole() {

  [
    "adminPanel",
    "driverPanel",
    "recipientPanel"
  ].forEach(id => {

    if ($(id)) {

      $(id)
        .classList
        .add("hidden");

    }

  });

  if (
    state.profile.role ===
    "admin"
  ) {

    if ($("adminPanel"))
      $("adminPanel")
        .classList
        .remove("hidden");

    await renderAdmin();

  }

  if (
    state.profile.role ===
    "driver"
  ) {

    if ($("driverPanel"))
      $("driverPanel")
        .classList
        .remove("hidden");

    await renderDriver();

  }

  if (
    state.profile.role ===
    "recipient"
  ) {

    if ($("recipientPanel"))
      $("recipientPanel")
        .classList
        .remove("hidden");

    await renderRecipient();

  }

}


/* =========================================================
   ADMIN
========================================================= */

async function renderAdmin() {

  try {

    const householdSnapshot =
      await getDocs(
        collection(
          db,
          "households"
        )
      );

    state.households =
      householdSnapshot.docs
        .map(d => ({
          id: d.id,
          ...d.data()
        }))
        .sort((a, b) =>
          String(
            a.name || ""
          ).localeCompare(
            String(
              b.name || ""
            ),
            "pt-BR"
          )
        );

    const deliverySnapshot =
      await getDocs(
        query(
          collection(
            db,
            "deliveries"
          ),
          limit(100)
        )
      );

    state.deliveries =
      deliverySnapshot.docs
        .map(d => ({
          id: d.id,
          ...d.data()
        }))
        .sort((a, b) =>
          String(
            b.scheduledDate || ""
          ).localeCompare(
            String(
              a.scheduledDate || ""
            )
          )
        );

    renderAdminMenu();

  } catch (error) {

    console.error(
      "Erro no painel administrativo:",
      error
    );

    $("adminPanel").innerHTML = `

      <div class="card">

        <h2>
          Erro ao carregar o painel
        </h2>

        <p>
          Não foi possível carregar os dados administrativos.
        </p>

        <p class="small">
          ${esc(error.message)}
        </p>

      </div>

    `;

  }

}


/* =========================================================
   MENU ADMINISTRATIVO
========================================================= */

function renderAdminMenu() {

  const pending =
    state.deliveries.filter(
      x =>
        x.status ===
        "scheduled"
    ).length;

  const completed =
    state.deliveries.filter(
      x =>
        x.status ===
        "completed"
    ).length;

  const awaiting =
    state.deliveries.filter(
      x =>
        x.status ===
        "awaiting_confirmation"
    ).length;

  $("adminPanel").innerHTML = `

    <div class="card">

      <div class="panel-title">

        <div>

          <h2>
            Painel administrativo
          </h2>

          <p class="small">
            Gestão do programa Água para Todos
          </p>

        </div>

      </div>

      <div class="stats">

        <div class="stat">
          <b>${state.households.length}</b>
          famílias
        </div>

        <div class="stat">
          <b>${pending}</b>
          programadas
        </div>

        <div class="stat">
          <b>${awaiting}</b>
          aguardando confirmação
        </div>

        <div class="stat">
          <b>${completed}</b>
          concluídas
        </div>

      </div>

    </div>


    <div class="card">

      <div class="panel-title">

        <h2>
          Cadastros
        </h2>

      </div>

      <div class="grid">

        <div
          class="item"
          style="cursor:pointer"
          data-admin-menu="households">

          <h3>
            👨‍👩‍👧‍👦 Famílias / Beneficiários
          </h3>

          <p>
            Cadastrar, consultar e editar
            as famílias atendidas.
          </p>

        </div>


        <div
          class="item"
          style="cursor:pointer"
          data-admin-menu="drivers">

          <h3>
            🚚 Motoristas
          </h3>

          <p>
            Cadastrar, consultar e editar
            os motoristas.
          </p>

        </div>


        <div
          class="item"
          style="cursor:pointer"
          data-admin-menu="users">

          <h3>
            👤 Usuários
          </h3>

          <p>
            Consultar e editar os usuários
            e seus respectivos perfis.
          </p>

        </div>

      </div>

    </div>


    <div class="card">

      <div class="panel-title">

        <h2>
          Operações
        </h2>

      </div>

      <div class="grid">

        <div
          class="item"
          style="cursor:pointer"
          data-admin-menu="new-delivery">

          <h3>
            📅 Programar entrega
          </h3>

          <p>
            Criar uma nova entrega e
            selecionar o motorista.
          </p>

        </div>


        <div
          class="item"
          style="cursor:pointer"
          data-admin-menu="scheduled">

          <h3>
            🚚 Entregas programadas
          </h3>

          <p>
            Visualizar e editar entregas
            ainda não realizadas.
          </p>

          <span class="pill scheduled">
            ${pending}
          </span>

        </div>


        <div
          class="item"
          style="cursor:pointer"
          data-admin-menu="awaiting">

          <h3>
            ⏳ Aguardando confirmação
          </h3>

          <p>
            Entregas aguardando confirmação
            do beneficiário.
          </p>

          <span class="pill scheduled">
            ${awaiting}
          </span>

        </div>


        <div
          class="item"
          style="cursor:pointer"
          data-admin-menu="completed">

          <h3>
            ✅ Entregas concluídas
          </h3>

          <p>
            Entregas finalizadas e
            confirmadas.
          </p>

          <span class="pill completed">
            ${completed}
          </span>

        </div>


        <div
          class="item"
          style="cursor:pointer"
          data-admin-menu="history">

          <h3>
            📋 Histórico
          </h3>

          <p>
            Consultar todas as entregas
            registradas.
          </p>

        </div>

      </div>

    </div>


    <div
      id="adminContent"
      style="margin-top:20px">
    </div>

  `;

  document
    .querySelectorAll(
      "[data-admin-menu]"
    )
    .forEach(button => {

      button.onclick =
        () =>
          handleAdminMenu(
            button.dataset.adminMenu
          );

    });

}


async function handleAdminMenu(section) {

  if (section === "households") {

    renderAdminHouseholds();
    return;

  }

  if (section === "drivers") {

    await renderAdminDrivers();
    return;

  }

  if (section === "users") {

    await renderAdminUsers();
    return;

  }

  if (section === "new-delivery") {

    await showDeliveryForm();
    return;

  }

  if (section === "scheduled") {

    renderAdminDeliveries(
      "scheduled",
      "Entregas programadas"
    );

    return;

  }

  if (section === "awaiting") {

    renderAdminDeliveries(
      "awaiting_confirmation",
      "Aguardando confirmação"
    );

    return;

  }

  if (section === "completed") {

    renderAdminDeliveries(
      "completed",
      "Entregas concluídas"
    );

    return;

  }

  if (section === "history") {

    renderAdminDeliveries(
      "all",
      "Histórico de entregas"
    );

  }

}


/* =========================================================
   FAMÍLIAS
========================================================= */

function renderAdminHouseholds() {

  const content =
    $("adminContent");

  if (!content) return;

  content.innerHTML = `

    <div class="card">

      <div class="panel-title">

        <div>

          <h2>
            Famílias / Beneficiários
          </h2>

          <p class="small">
            ${state.households.length}
            cadastro(s) encontrado(s).
          </p>

        </div>

        <div class="actions">

          <button
            class="primary"
            id="adminNewHousehold">

            + Cadastrar família

          </button>

        </div>

      </div>


      <div class="grid">

        ${
          state.households
            .map(householdCard)
            .join("")
          ||
          "<p class='small'>Nenhuma família cadastrada.</p>"
        }

      </div>

    </div>

  `;

  $("adminNewHousehold").onclick =
    showHouseholdForm;

  document
    .querySelectorAll(
      "[data-edit-household]"
    )
    .forEach(button => {

      button.onclick =
        () =>
          showEditHouseholdForm(
            button.dataset.editHousehold
          );

    });

}


/* =========================================================
   CARTÃO DA FAMÍLIA
========================================================= */

function householdCard(h) {

  const accessText =
    h.recipientUid
      ? "Acesso criado"
      : "Sem acesso";

  return `

    <div class="item">

      <div class="row">

        <h3>
          ${esc(
            h.name ||
            "Sem nome"
          )}
        </h3>

        <span class="pill ${
          h.active === false
            ? "cancelled"
            : "completed"
        }">

          ${
            h.active === false
              ? "Inativa"
              : "Ativa"
          }

        </span>

      </div>


      <p>

        <b>Telefone:</b>
        ${esc(h.phone || "—")}

        ${
          h.cpf
            ? ` · <b>CPF:</b> ${esc(h.cpf)}`
            : ""
        }

      </p>


      <p>
        <b>Comunidade:</b>
        ${esc(h.community || "—")}
      </p>


      <p>
        <b>Endereço:</b>
        ${esc(h.address || "—")}
      </p>


      <p>

        <b>Pessoas:</b>
        ${esc(h.people || "—")}

        ·

        <b>Frequência:</b>
        ${esc(h.frequency || "—")}

        ·

        <b>Litros:</b>
        ${esc(h.defaultLiters || "—")} L

      </p>


      <p>

        <b>Acesso ao aplicativo:</b>
        ${accessText}

        ${
          h.recipientEmail
            ? ` · ${esc(h.recipientEmail)}`
            : ""
        }

      </p>


      <div class="actions">

        <button
          class="secondary"
          data-edit-household="${esc(h.id)}">

          ✏️ Editar cadastro

        </button>

      </div>

    </div>

  `;

}


/* =========================================================
   CADASTRAR FAMÍLIA + ACESSO DO BENEFICIÁRIO
========================================================= */

function showHouseholdForm() {

  openModal(`

    <h2>
      Nova família / imóvel
    </h2>


    <form id="householdForm">

      <label>
        Nome do responsável
        <input
          id="hName"
          autocomplete="name"
          required>
      </label>


      <label>
        CPF (opcional)
        <input
          id="hCpf"
          inputmode="numeric">
      </label>


      <label>
        Telefone
        <input
          id="hPhone"
          type="tel"
          autocomplete="tel"
          required>
      </label>


      <div class="notice">

        <b>Acesso do beneficiário</b><br>

        Este e-mail e senha serão usados
        pelo beneficiário para entrar no aplicativo.

      </div>


      <label>
        E-mail de acesso
        <input
          id="hEmail"
          type="email"
          autocomplete="email"
          required>
      </label>


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


      <p class="small">
        A senha precisa ter pelo menos 6 caracteres.
        Ela não será armazenada no banco de dados.
      </p>


      <label>
        Comunidade / zona rural
        <input
          id="hCommunity"
          required>
      </label>


      <label>
        Endereço / referência
        <input
          id="hAddress"
          required>
      </label>


      <label>
        Quantidade de pessoas
        <input
          id="hPeople"
          type="number"
          min="1"
          required>
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

        <input
          id="hLiters"
          type="number"
          min="1"
          required>

      </label>


      <div class="actions">

        <button
          type="button"
          class="secondary"
          id="cancelNewHousehold">

          Cancelar

        </button>

        <button
          class="primary"
          id="saveHousehold">

          Salvar família

        </button>

      </div>

    </form>

  `);


  $("cancelNewHousehold").onclick =
    closeModal;


  $("householdForm").onsubmit =
    async e => {

      e.preventDefault();


      const button =
        $("saveHousehold");


      const name =
        $("hName")
          .value
          .trim();


      const cpf =
        $("hCpf")
          .value
          .trim();


      const phone =
        $("hPhone")
          .value
          .trim();


      const email =
        $("hEmail")
          .value
          .trim()
          .toLowerCase();


      const password =
        $("hPassword")
          .value;


      const passwordConfirm =
        $("hPasswordConfirm")
          .value;


      const community =
        $("hCommunity")
          .value
          .trim();


      const address =
        $("hAddress")
          .value
          .trim();


      const people =
        Number(
          $("hPeople")
            .value
        );


      const frequency =
        $("hFreq")
          .value;


      const defaultLiters =
        Number(
          $("hLiters")
            .value
        );


      if (!name) {

        toast(
          "Informe o nome do responsável."
        );

        return;

      }


      if (!phone) {

        toast(
          "Informe o telefone."
        );

        return;

      }


      if (!email) {

        toast(
          "Informe o e-mail de acesso."
        );

        return;

      }


      if (password.length < 6) {

        toast(
          "A senha precisa ter pelo menos 6 caracteres."
        );

        return;

      }


      if (
        password !==
        passwordConfirm
      ) {

        toast(
          "As senhas não conferem."
        );

        return;

      }


      if (!community) {

        toast(
          "Informe a comunidade ou zona rural."
        );

        return;

      }


      if (!address) {

        toast(
          "Informe o endereço ou referência."
        );

        return;

      }


      if (
        !Number.isFinite(people) ||
        people < 1
      ) {

        toast(
          "Informe uma quantidade válida de pessoas."
        );

        return;

      }


      if (
        !Number.isFinite(defaultLiters) ||
        defaultLiters < 1
      ) {

        toast(
          "Informe uma quantidade válida de litros."
        );

        return;

      }


      if (!secondaryAuth) {

        toast(
          "Não foi possível preparar o cadastro do beneficiário."
        );

        return;

      }


      let createdUser =
        null;

      let createdUserProfile =
        false;

      let createdHouseholdId =
        null;


      try {

        button.disabled =
          true;

        button.textContent =
          "Criando acesso...";


        /*
          1. CRIA O USUÁRIO NO FIREBASE AUTH
        */

        const credential =
          await createUserWithEmailAndPassword(
            secondaryAuth,
            email,
            password
          );


        createdUser =
          credential.user;


        /*
          2. CRIA O PERFIL DO BENEFICIÁRIO
        */

        await setDoc(
          doc(
            db,
            "users",
            createdUser.uid
          ),
          {

            name,

            email,

            phone,

            role:
              "recipient",

            active:
              true,

            createdAt:
              serverTimestamp(),

            createdBy:
              state.user.uid

          }
        );


        createdUserProfile =
          true;


        /*
          3. CRIA O CADASTRO DA FAMÍLIA
        */

        button.textContent =
          "Salvando família...";


        const householdRef =
          await addDoc(
            collection(
              db,
              "households"
            ),
            {

              name,

              cpf,

              phone,

              email,

              recipientEmail:
                email,

              recipientUid:
                createdUser.uid,

              community,

              address,

              people,

              frequency,

              defaultLiters,

              active:
                true,

              createdAt:
                serverTimestamp(),

              createdBy:
                state.user.uid

            }
          );


        createdHouseholdId =
          householdRef.id;


        /*
          4. VINCULA A FAMÍLIA AO USUÁRIO
        */

        await updateDoc(
          doc(
            db,
            "users",
            createdUser.uid
          ),
          {

            householdId:
              createdHouseholdId,

            updatedAt:
              serverTimestamp(),

            updatedBy:
              state.user.uid

          }
        );


        /*
          5. DESCONECTA O FIREBASE SECUNDÁRIO
        */

        try {

          await signOutSecondary(
            secondaryAuth
          );

        } catch (_) {}


        closeModal();


        toast(
          "Família e acesso do beneficiário cadastrados com sucesso."
        );


        await renderAdmin();


      } catch (error) {

        console.error(
          "Erro ao cadastrar família e beneficiário:",
          error
        );


        /*
          TENTATIVA DE LIMPEZA
          CASO ALGUMA ETAPA TENHA FALHADO
        */

        if (
          createdHouseholdId
        ) {

          try {

            await deleteDoc(
              doc(
                db,
                "households",
                createdHouseholdId
              )
            );

          } catch (cleanupError) {

            console.warn(
              "Não foi possível remover o cadastro incompleto da família:",
              cleanupError
            );

          }

        }


        if (
          createdUserProfile &&
          createdUser
        ) {

          try {

            await deleteDoc(
              doc(
                db,
                "users",
                createdUser.uid
              )
            );

          } catch (cleanupError) {

            console.warn(
              "Não foi possível remover o perfil incompleto:",
              cleanupError
            );

          }

        }


        if (createdUser) {

          try {

            await deleteUser(
              createdUser
            );

          } catch (cleanupError) {

            console.warn(
              "Não foi possível remover o usuário do Firebase Auth:",
              cleanupError
            );

          }

        }


        try {

          await signOutSecondary(
            secondaryAuth
          );

        } catch (_) {}


        if (
          error.code ===
          "auth/email-already-in-use"
        ) {

          toast(
            "Este e-mail já está cadastrado no sistema."
          );

        } else if (
          error.code ===
          "auth/invalid-email"
        ) {

          toast(
            "O e-mail informado é inválido."
          );

        } else if (
          error.code ===
          "auth/weak-password"
        ) {

          toast(
            "A senha é muito fraca."
          );

        } else if (
          error.code ===
          "permission-denied"
        ) {

          toast(
            "O Firestore bloqueou o cadastro. Verifique as regras do banco."
          );

        } else {

          toast(
            "Não foi possível cadastrar a família e o acesso."
          );

        }

      } finally {

        button.disabled =
          false;

        button.textContent =
          "Salvar família";

      }

    };

}


/* =========================================================
   EDITAR FAMÍLIA
========================================================= */

function showEditHouseholdForm(id) {

  const h =
    state.households.find(
      x => x.id === id
    );

  if (!h) {

    toast(
      "Família não encontrada."
    );

    return;

  }

  openModal(`

    <h2>
      Editar família / imóvel
    </h2>


    <form id="editHouseholdForm">

      <label>
        Nome do responsável

        <input
          id="ehName"
          value="${esc(h.name || "")}"
          required>

      </label>


      <label>
        CPF

        <input
          id="ehCpf"
          inputmode="numeric"
          value="${esc(h.cpf || "")}">

      </label>


      <label>
        Telefone

        <input
          id="ehPhone"
          value="${esc(h.phone || "")}"
          required>

      </label>


      <label>
        E-mail do beneficiário

        <input
          value="${esc(
            h.recipientEmail ||
            h.email ||
            ""
          )}"
          disabled>

      </label>


      <div class="notice">

        ${
          h.recipientUid
            ? "Este cadastro já possui acesso ao aplicativo."
            : "Este cadastro ainda não possui acesso ao aplicativo. O acesso poderá ser criado em uma etapa posterior."
        }

      </div>


      <label>
        Comunidade / zona rural

        <input
          id="ehCommunity"
          value="${esc(h.community || "")}"
          required>

      </label>


      <label>
        Endereço / referência

        <input
          id="ehAddress"
          value="${esc(h.address || "")}"
          required>

      </label>


      <label>
        Quantidade de pessoas

        <input
          id="ehPeople"
          type="number"
          min="1"
          value="${esc(h.people || 1)}"
          required>

      </label>


      <label>
        Frequência

        <select id="ehFreq">

          <option
            ${h.frequency === "Semanal" ? "selected" : ""}>
            Semanal
          </option>

          <option
            ${h.frequency === "Quinzenal" ? "selected" : ""}>
            Quinzenal
          </option>

          <option
            ${h.frequency === "Mensal" ? "selected" : ""}>
            Mensal
          </option>

          <option
            ${h.frequency === "Conforme necessidade" ? "selected" : ""}>
            Conforme necessidade
          </option>

        </select>

      </label>


      <label>
        Litros programados por entrega

        <input
          id="ehLiters"
          type="number"
          min="1"
          value="${esc(h.defaultLiters || "")}"
          required>

      </label>


      <label>
        Situação

        <select id="ehActive">

          <option
            value="true"
            ${h.active !== false ? "selected" : ""}>
            Ativa
          </option>

          <option
            value="false"
            ${h.active === false ? "selected" : ""}>
            Inativa
          </option>

        </select>

      </label>


      <div class="actions">

        <button
          type="button"
          class="secondary"
          id="cancelEdit">

          Cancelar

        </button>

        <button
          type="submit"
          class="primary">

          Salvar alterações

        </button>

      </div>

    </form>

  `);

  $("cancelEdit").onclick =
    closeModal;

  $("editHouseholdForm").onsubmit =
    async e => {

      e.preventDefault();

      try {

        await updateDoc(
          doc(
            db,
            "households",
            id
          ),
          {

            name:
              $("ehName").value.trim(),

            cpf:
              $("ehCpf").value.trim(),

            phone:
              $("ehPhone").value.trim(),

            community:
              $("ehCommunity").value.trim(),

            address:
              $("ehAddress").value.trim(),

            people:
              Number(
                $("ehPeople").value
              ),

            frequency:
              $("ehFreq").value,

            defaultLiters:
              Number(
                $("ehLiters").value
              ),

            active:
              $("ehActive").value ===
              "true",

            updatedAt:
              serverTimestamp(),

            updatedBy:
              state.user.uid

          }
        );

        closeModal();

        toast(
          "Cadastro atualizado com sucesso."
        );

        await renderAdmin();

      } catch (error) {

        console.error(
          "Erro ao atualizar família:",
          error
        );

        toast(
          "Não foi possível atualizar o cadastro."
        );

      }

    };

}


/* =========================================================
   MOTORISTAS
========================================================= */

async function loadDrivers() {

  const snapshot =
    await getDocs(
      query(
        collection(
          db,
          "users"
        ),
        where(
          "role",
          "==",
          "driver"
        ),
        limit(100)
      )
    );

  state.drivers =
    snapshot.docs
      .map(d => ({
        id: d.id,
        ...d.data()
      }))
      .sort((a, b) =>
        String(a.name || "")
          .localeCompare(
            String(b.name || ""),
            "pt-BR"
          )
      );

  return state.drivers;

}


async function renderAdminDrivers() {

  const content =
    $("adminContent");

  if (!content) return;

  try {

    await loadDrivers();

    content.innerHTML = `

      <div class="card">

        <div class="panel-title">

          <div>

            <h2>
              Motoristas
            </h2>

            <p class="small">
              ${state.drivers.length}
              motorista(s) cadastrado(s).
            </p>

          </div>

          <div class="actions">

            <button
              class="primary"
              id="newDriverBtn">

              + Cadastrar motorista

            </button>

          </div>

        </div>


        <div class="grid">

          ${
            state.drivers
              .map(
                driver => `

                  <div class="item">

                    <div class="row">

                      <h3>
                        ${esc(
                          driver.name ||
                          "Motorista"
                        )}
                      </h3>

                      <span class="pill ${
                        driver.active === false
                          ? "cancelled"
                          : "completed"
                      }">

                        ${
                          driver.active === false
                            ? "Inativo"
                            : "Ativo"
                        }

                      </span>

                    </div>


                    <p>
                      <b>E-mail:</b>
                      ${esc(
                        driver.email ||
                        "Não informado"
                      )}
                    </p>


                    <p>
                      <b>Telefone:</b>
                      ${esc(
                        driver.phone ||
                        "Não informado"
                      )}
                    </p>


                    <p class="small">
                      UID:
                      ${esc(driver.id)}
                    </p>


                    <div class="actions">

                      <button
                        type="button"
                        class="secondary"
                        data-edit-driver="${esc(driver.id)}">

                        ✏️ Editar motorista

                      </button>

                    </div>

                  </div>

                `
              )
              .join("")
            ||
            "<p class='small'>Nenhum motorista cadastrado.</p>"
          }

        </div>

      </div>

    `;

    $("newDriverBtn").onclick =
      showDriverForm;

    document
      .querySelectorAll(
        "[data-edit-driver]"
      )
      .forEach(button => {

        button.onclick =
          () =>
            showEditDriverForm(
              button.dataset.editDriver
            );

      });

  } catch (error) {

    console.error(
      "Erro ao carregar motoristas:",
      error
    );

    content.innerHTML = `

      <div class="card">

        <h2>
          Erro ao carregar motoristas
        </h2>

        <p class="small">
          ${esc(error.message)}
        </p>

      </div>

    `;

  }

}


/* =========================================================
   CADASTRAR MOTORISTA
========================================================= */

function showDriverForm() {

  openModal(`

    <h2>
      Cadastrar motorista
    </h2>

    <div class="notice">

      Será criado um usuário de acesso próprio
      para o motorista.

    </div>


    <form id="driverForm">

      <label>
        Nome completo

        <input
          id="driverName"
          type="text"
          autocomplete="name"
          required>

      </label>


      <label>
        E-mail de acesso

        <input
          id="driverEmail"
          type="email"
          autocomplete="email"
          required>

      </label>


      <label>
        Telefone

        <input
          id="driverPhone"
          type="tel"
          autocomplete="tel"
          required>

      </label>


      <label>
        Senha inicial

        <input
          id="driverPassword"
          type="password"
          minlength="6"
          autocomplete="new-password"
          required>

      </label>


      <p class="small">
        A senha precisa ter pelo menos 6 caracteres.
      </p>


      <div class="actions">

        <button
          type="button"
          class="secondary"
          id="cancelDriver">

          Cancelar

        </button>

        <button
          type="submit"
          class="primary"
          id="saveDriver">

          Cadastrar motorista

        </button>

      </div>

    </form>

  `);

  $("cancelDriver").onclick =
    closeModal;

  $("driverForm").onsubmit =
    async e => {

      e.preventDefault();

      const button =
        $("saveDriver");

      const name =
        $("driverName").value.trim();

      const email =
        $("driverEmail")
          .value
          .trim()
          .toLowerCase();

      const phone =
        $("driverPhone").value.trim();

      const password =
        $("driverPassword").value;

      if (!name) {

        toast(
          "Informe o nome do motorista."
        );

        return;

      }

      if (!email) {

        toast(
          "Informe o e-mail do motorista."
        );

        return;

      }

      if (!phone) {

        toast(
          "Informe o telefone do motorista."
        );

        return;

      }

      if (password.length < 6) {

        toast(
          "A senha precisa ter pelo menos 6 caracteres."
        );

        return;

      }

      if (!secondaryAuth) {

        toast(
          "Não foi possível preparar o cadastro do motorista."
        );

        return;

      }

      try {

        button.disabled =
          true;

        button.textContent =
          "Cadastrando...";

        const credential =
          await createUserWithEmailAndPassword(
            secondaryAuth,
            email,
            password
          );

        const newUser =
          credential.user;

        await setDoc(
          doc(
            db,
            "users",
            newUser.uid
          ),
          {

            name,
            email,
            phone,

            role:
              "driver",

            active:
              true,

            createdAt:
              serverTimestamp(),

            createdBy:
              state.user.uid

          }
        );

        await signOutSecondary(
          secondaryAuth
        );

        closeModal();

        toast(
          "Motorista cadastrado com sucesso."
        );

        await renderAdmin();

        await renderAdminDrivers();

      } catch (error) {

        console.error(
          "Erro ao cadastrar motorista:",
          error
        );

        if (
          error.code ===
          "auth/email-already-in-use"
        ) {

          toast(
            "Este e-mail já está cadastrado."
          );

        } else if (
          error.code ===
          "auth/invalid-email"
        ) {

          toast(
            "O e-mail informado é inválido."
          );

        } else if (
          error.code ===
          "auth/weak-password"
        ) {

          toast(
            "A senha é muito fraca."
          );

        } else if (
          error.code ===
          "permission-denied"
        ) {

          toast(
            "O Firestore bloqueou a criação do perfil."
          );

        } else {

          toast(
            "Não foi possível cadastrar o motorista."
          );

        }

        try {

          await signOutSecondary(
            secondaryAuth
          );

        } catch (_) {}

        button.disabled =
          false;

        button.textContent =
          "Cadastrar motorista";

      }

    };

}


/* =========================================================
   EDITAR MOTORISTA
========================================================= */

function showEditDriverForm(id) {

  const driver =
    state.drivers.find(
      x => x.id === id
    );

  if (!driver) {

    toast(
      "Motorista não encontrado."
    );

    return;

  }

  openModal(`

    <h2>
      Editar motorista
    </h2>


    <div class="notice">

      O e-mail de acesso não será alterado
      nesta tela. Aqui serão alterados os
      dados do cadastro e a situação do motorista.

    </div>


    <form id="editDriverForm">

      <label>
        Nome completo

        <input
          id="edDriverName"
          value="${esc(driver.name || "")}"
          required>

      </label>


      <label>
        E-mail

        <input
          value="${esc(driver.email || "")}"
          disabled>

      </label>


      <label>
        Telefone

        <input
          id="edDriverPhone"
          value="${esc(driver.phone || "")}"
          required>

      </label>


      <label>
        Situação

        <select id="edDriverActive">

          <option
            value="true"
            ${driver.active !== false ? "selected" : ""}>

            Ativo

          </option>

          <option
            value="false"
            ${driver.active === false ? "selected" : ""}>

            Inativo

          </option>

        </select>

      </label>


      <p class="small">
        O UID do motorista permanece o mesmo
        para não quebrar as entregas já vinculadas.
      </p>


      <div class="actions">

        <button
          type="button"
          class="secondary"
          id="cancelEditDriver">

          Cancelar

        </button>

        <button
          type="submit"
          class="primary">

          Salvar alterações

        </button>

      </div>

    </form>

  `);

  $("cancelEditDriver").onclick =
    closeModal;

  $("editDriverForm").onsubmit =
    async e => {

      e.preventDefault();

      try {

        await updateDoc(
          doc(
            db,
            "users",
            id
          ),
          {

            name:
              $("edDriverName")
                .value
                .trim(),

            phone:
              $("edDriverPhone")
                .value
                .trim(),

            active:
              $("edDriverActive")
                .value === "true",

            updatedAt:
              serverTimestamp(),

            updatedBy:
              state.user.uid

          }
        );

        closeModal();

        toast(
          "Motorista atualizado com sucesso."
        );

        await renderAdmin();

        await renderAdminDrivers();

      } catch (error) {

        console.error(
          "Erro ao editar motorista:",
          error
        );

        toast(
          "Não foi possível atualizar o motorista."
        );

      }

    };

}


/* =========================================================
   USUÁRIOS
========================================================= */

async function renderAdminUsers() {

  const content =
    $("adminContent");

  if (!content) return;

  try {

    const snapshot =
      await getDocs(
        query(
          collection(
            db,
            "users"
          ),
          limit(100)
        )
      );

    const users =
      snapshot.docs
        .map(d => ({
          id: d.id,
          ...d.data()
        }))
        .sort((a, b) =>
          String(a.name || "")
            .localeCompare(
              String(b.name || ""),
              "pt-BR"
            )
        );

    state.users =
      users;

    content.innerHTML = `

      <div class="card">

        <div class="panel-title">

          <div>

            <h2>
              Usuários
            </h2>

            <p class="small">
              ${users.length}
              usuário(s) encontrado(s).
            </p>

          </div>

        </div>


        <div class="grid">

          ${
            users
              .map(
                user => `

                  <div class="item">

                    <div class="row">

                      <h3>
                        ${esc(
                          user.name ||
                          "Usuário"
                        )}
                      </h3>

                      <span class="pill ${
                        user.active === false
                          ? "cancelled"
                          : "completed"
                      }">

                        ${
                          user.active === false
                            ? "Inativo"
                            : roleLabel(user.role)
                        }

                      </span>

                    </div>


                    <p>
                      <b>E-mail:</b>
                      ${esc(
                        user.email ||
                        "Não informado"
                      )}
                    </p>


                    <p>
                      <b>Telefone:</b>
                      ${esc(
                        user.phone ||
                        "Não informado"
                      )}
                    </p>


                    <p>
                      <b>Perfil:</b>
                      ${esc(
                        roleLabel(
                          user.role
                        )
                      )}
                    </p>


                    <p class="small">
                      UID:
                      ${esc(user.id)}
                    </p>


                    <div class="actions">

                      <button
                        type="button"
                        class="secondary"
                        data-edit-user="${esc(user.id)}">

                        ✏️ Editar usuário

                      </button>

                    </div>

                  </div>

                `
              )
              .join("")
            ||
            "<p class='small'>Nenhum usuário cadastrado.</p>"
          }

        </div>

      </div>

    `;

    document
      .querySelectorAll(
        "[data-edit-user]"
      )
      .forEach(button => {

        button.onclick =
          () =>
            showEditUserForm(
              button.dataset.editUser
            );

      });

  } catch (error) {

    console.error(
      "Erro ao carregar usuários:",
      error
    );

    content.innerHTML = `

      <div class="card">

        <h2>
          Erro ao carregar usuários
        </h2>

        <p class="small">
          ${esc(error.message)}
        </p>

      </div>

    `;

  }

}


/* =========================================================
   EDITAR USUÁRIO
========================================================= */

function showEditUserForm(id) {

  const user =
    state.users.find(
      x => x.id === id
    );

  if (!user) {

    toast(
      "Usuário não encontrado."
    );

    return;

  }

  openModal(`

    <h2>
      Editar usuário
    </h2>


    <div class="notice">

      O e-mail de login não será alterado
      nesta tela.

    </div>


    <form id="editUserForm">

      <label>
        Nome

        <input
          id="euName"
          value="${esc(user.name || "")}"
          required>

      </label>


      <label>
        E-mail

        <input
          value="${esc(user.email || "")}"
          disabled>

      </label>


      <label>
        Telefone

        <input
          id="euPhone"
          value="${esc(user.phone || "")}">

      </label>


      <label>
        Perfil

        <select id="euRole">

          <option
            value="admin"
            ${user.role === "admin" ? "selected" : ""}>

            Administrador

          </option>

          <option
            value="driver"
            ${user.role === "driver" ? "selected" : ""}>

            Motorista

          </option>

          <option
            value="recipient"
            ${user.role === "recipient" ? "selected" : ""}>

            Beneficiário

          </option>

        </select>

      </label>


      <label>
        Situação

        <select id="euActive">

          <option
            value="true"
            ${user.active !== false ? "selected" : ""}>

            Ativo

          </option>

          <option
            value="false"
            ${user.active === false ? "selected" : ""}>

            Inativo

          </option>

        </select>

      </label>


      <div class="actions">

        <button
          type="button"
          class="secondary"
          id="cancelEditUser">

          Cancelar

        </button>

        <button
          type="submit"
          class="primary">

          Salvar alterações

        </button>

      </div>

    </form>

  `);

  $("cancelEditUser").onclick =
    closeModal;

  $("editUserForm").onsubmit =
    async e => {

      e.preventDefault();

      try {

        await updateDoc(
          doc(
            db,
            "users",
            id
          ),
          {

            name:
              $("euName")
                .value
                .trim(),

            phone:
              $("euPhone")
                .value
                .trim(),

            role:
              $("euRole").value,

            active:
              $("euActive").value ===
              "true",

            updatedAt:
              serverTimestamp(),

            updatedBy:
              state.user.uid

          }
        );

        closeModal();

        toast(
          "Usuário atualizado com sucesso."
        );

        await renderAdmin();

        await renderAdminUsers();

      } catch (error) {

        console.error(
          "Erro ao editar usuário:",
          error
        );

        toast(
          "Não foi possível atualizar o usuário."
        );

      }

    };

}


/* =========================================================
   ENTREGAS ADMIN
========================================================= */

function renderAdminDeliveries(
  filter,
  title
) {

  const content =
    $("adminContent");

  if (!content) return;

  let list;

  if (filter === "all") {

    list =
      state.deliveries;

  } else {

    list =
      state.deliveries.filter(
        d =>
          d.status ===
          filter
      );

  }

  content.innerHTML = `

    <div class="card">

      <div class="panel-title">

        <div>

          <h2>
            ${esc(title)}
          </h2>

          <p class="small">
            ${list.length}
            entrega(s) encontrada(s).
          </p>

        </div>

        <div class="actions">

          <button
            class="yellow"
            id="adminNewDelivery">

            + Programar entrega

          </button>

        </div>

      </div>


      <div class="grid">

        ${
          list
            .map(deliveryCard)
            .join("")
          ||
          "<p class='small'>Nenhuma entrega encontrada.</p>"
        }

      </div>

    </div>

  `;

  $("adminNewDelivery").onclick =
    showDeliveryForm;

  document
    .querySelectorAll(
      "[data-view-delivery]"
    )
    .forEach(button => {

      button.onclick =
        () =>
          showDeliveryDetails(
            button.dataset.viewDelivery
          );

    });

  document
    .querySelectorAll(
      "[data-edit-delivery]"
    )
    .forEach(button => {

      button.onclick =
        () =>
          showEditDeliveryForm(
            button.dataset.editDelivery
          );

    });

}


/* =========================================================
   CARTÃO DA ENTREGA
========================================================= */

function deliveryCard(d) {

  const canEdit =
    d.status === "scheduled" ||
    d.status === "awaiting_confirmation";

  return `

    <div class="item">

      <div class="row">

        <h3>
          ${esc(
            d.recipientName ||
            "Beneficiário"
          )}
        </h3>

        <span class="pill ${esc(
          d.status
        )}">

          ${statusLabel(
            d.status
          )}

        </span>

      </div>


      <p>

        <b>Data:</b>
        ${esc(d.scheduledDate || "—")}

        ·

        <b>Quantidade:</b>
        ${esc(d.plannedLiters || "—")} L

      </p>


      <p>

        <b>Local:</b>
        ${esc(d.address || "—")}

        ·

        <b>Motorista:</b>
        ${esc(d.driverName || "—")}

      </p>


      ${
        d.completedAt
          ? `

            <p>

              <b>Registrada:</b>
              ${fmtDate(d.completedAt)}

              ·

              <b>Recebido:</b>
              ${esc(
                d.receivedLiters ||
                "—"
              )} L

            </p>

          `
          : ""
      }


      <div class="actions">

        <button
          type="button"
          class="secondary"
          data-view-delivery="${esc(d.id)}">

          👁️ Ver detalhes

        </button>


        ${
          canEdit
            ? `

              <button
                type="button"
                class="secondary"
                data-edit-delivery="${esc(d.id)}">

                ✏️ Editar entrega

              </button>

            `
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

    const deliverySnapshot =
      await getDoc(
        doc(
          db,
          "deliveries",
          id
        )
      );

    if (!deliverySnapshot.exists()) {

      toast(
        "Entrega não encontrada."
      );

      return;

    }

    const d = {
      id: deliverySnapshot.id,
      ...deliverySnapshot.data()
    };

    const presentText =
      d.recipientPresent === true
        ? "Sim"
        : d.recipientPresent === false
          ? "Não"
          : "Não informado";

    const signatureHtml =
      d.signatureData
        ? `

          <div style="margin-top:18px;">

            <h3>
              Assinatura do beneficiário
            </h3>

            <div
              style="
                background:#ffffff;
                border:1px solid #ddd;
                border-radius:10px;
                padding:10px;
              ">

              <img
                src="${esc(d.signatureData)}"
                alt="Assinatura do beneficiário"
                style="
                  display:block;
                  width:100%;
                  max-width:500px;
                  height:auto;
                  background:#fff;
                ">

            </div>

          </div>

        `
        : "";

    const photoHtml =
      d.photoUrl
        ? `

          <div style="margin-top:18px;">

            <h3>
              Foto de comprovação
            </h3>

            <img
              src="${esc(d.photoUrl)}"
              alt="Foto da entrega"
              style="
                display:block;
                width:100%;
                max-width:600px;
                border-radius:8px;
              ">

            <p style="margin-top:10px;">

              <a
                href="${esc(d.photoUrl)}"
                target="_blank"
                rel="noopener noreferrer">

                Abrir foto em tamanho maior

              </a>

            </p>

          </div>

        `
        : "";

    openModal(`

      <h2>
        Detalhes da entrega
      </h2>


      <div class="notice">

        <b>Situação:</b>
        ${esc(statusLabel(d.status))}

      </div>


      <div class="item">

        <h3>
          Beneficiário
        </h3>

        <p>
          <b>Nome:</b>
          ${esc(d.recipientName || "—")}
        </p>

        <p>
          <b>Telefone:</b>
          ${esc(d.recipientPhone || "—")}
        </p>

      </div>


      <div class="item">

        <h3>
          Local do abastecimento
        </h3>

        <p>
          <b>Comunidade:</b>
          ${esc(d.community || "—")}
        </p>

        <p>
          <b>Endereço:</b>
          ${esc(d.address || "—")}
        </p>

      </div>


      <div class="item">

        <h3>
          Programação
        </h3>

        <p>
          <b>Data programada:</b>
          ${esc(d.scheduledDate || "—")}
        </p>

        <p>
          <b>Quantidade planejada:</b>
          ${esc(d.plannedLiters || "—")} L
        </p>

        <p>
          <b>Motorista:</b>
          ${esc(d.driverName || "—")}
        </p>

        <p>
          <b>UID do motorista:</b>
          ${esc(d.driverUid || "—")}
        </p>

      </div>


      <div class="item">

        <h3>
          Resultado do abastecimento
        </h3>

        <p>
          <b>Quantidade realmente entregue:</b>
          ${
            d.receivedLiters !== undefined &&
            d.receivedLiters !== null
              ? `${esc(d.receivedLiters)} L`
              : "Ainda não registrada"
          }
        </p>

        <p>
          <b>Beneficiário presente:</b>
          ${presentText}
        </p>

        <p>
          <b>Data/hora do registro:</b>
          ${fmtDate(d.completedAt)}
        </p>

        <p>
          <b>Registrado pelo UID:</b>
          ${esc(d.completedBy || "—")}
        </p>

        <p>
          <b>Observação:</b>
          ${esc(d.note || "Nenhuma")}
        </p>

      </div>


      ${signatureHtml}

      ${photoHtml}


      <div class="item">

        <h3>
          Controle e auditoria
        </h3>

        <p>
          <b>ID da entrega:</b>
          ${esc(d.id)}
        </p>

        <p>
          <b>Criada em:</b>
          ${fmtDate(d.createdAt)}
        </p>

        <p>
          <b>Criada pelo UID:</b>
          ${esc(d.createdBy || "—")}
        </p>

        <p>
          <b>Última alteração:</b>
          ${fmtDate(d.updatedAt)}
        </p>

        <p>
          <b>Alterada pelo UID:</b>
          ${esc(d.updatedBy || "—")}
        </p>

      </div>


      <div class="actions">

        ${
          d.status === "scheduled" ||
          d.status === "awaiting_confirmation"
            ? `

              <button
                type="button"
                class="secondary"
                id="editFromDetails">

                ✏️ Editar entrega

              </button>

            `
            : ""
        }


        <button
          type="button"
          class="primary"
          id="closeDeliveryDetails">

          Fechar

        </button>

      </div>

    `);

    if ($("closeDeliveryDetails")) {

      $("closeDeliveryDetails").onclick =
        closeModal;

    }

    if ($("editFromDetails")) {

      $("editFromDetails").onclick =
        () => {

          closeModal();

          showEditDeliveryForm(
            id
          );

        };

    }

  } catch (error) {

    console.error(
      "Erro ao carregar detalhes:",
      error
    );

    toast(
      "Não foi possível carregar os detalhes."
    );

  }

}


/* =========================================================
   EDITAR ENTREGA
========================================================= */

async function showEditDeliveryForm(id) {

  const d =
    state.deliveries.find(
      x => x.id === id
    );

  if (!d) {

    toast(
      "Entrega não encontrada."
    );

    return;

  }


  if (
    d.status !== "scheduled" &&
    d.status !== "awaiting_confirmation"
  ) {

    toast(
      "Esta entrega já possui registro de execução e não pode ter sua programação alterada por esta tela."
    );

    return;

  }


  try {

    await loadDrivers();

  } catch (error) {

    toast(
      "Não foi possível carregar os motoristas."
    );

    return;

  }


  openModal(`

    <h2>
      Editar entrega
    </h2>


    <div class="notice">

      Esta tela altera somente a programação.
      Os registros feitos pelo motorista
      permanecem preservados.

    </div>


    <form id="editDeliveryForm">

      <label>
        Família / beneficiário

        <select id="edDeliveryHousehold">

          ${
            state.households
              .filter(
                h =>
                  h.active !== false ||
                  h.id === d.householdId
              )
              .map(
                h => `

                  <option
                    value="${esc(h.id)}"
                    ${
                      h.id === d.householdId
                        ? "selected"
                        : ""
                    }>

                    ${esc(h.name)}
                    —
                    ${esc(h.community)}

                  </option>

                `
              )
              .join("")
          }

        </select>

      </label>


      <label>
        Data programada

        <input
          id="edDeliveryDate"
          type="date"
          value="${esc(d.scheduledDate || "")}"
          required>

      </label>


      <label>
        Quantidade planejada (litros)

        <input
          id="edDeliveryLiters"
          type="number"
          min="1"
          value="${esc(d.plannedLiters || "")}"
          required>

      </label>


      <label>
        Motorista

        <select
          id="edDeliveryDriver"
          required>

          ${
            state.drivers
              .map(
                driver => `

                  <option
                    value="${esc(driver.id)}"
                    ${
                      driver.id === d.driverUid
                        ? "selected"
                        : ""
                    }>

                    ${esc(
                      driver.name ||
                      "Motorista"
                    )}

                    ${
                      driver.active === false
                        ? " (Inativo)"
                        : ""
                    }

                  </option>

                `
              )
              .join("")
          }

        </select>

      </label>


      <label>
        Observação

        <textarea
          id="edDeliveryNote">${esc(
            d.note || ""
          )}</textarea>

      </label>


      <div class="actions">

        <button
          type="button"
          class="secondary"
          id="cancelEditDelivery">

          Cancelar

        </button>


        <button
          type="submit"
          class="primary">

          Salvar alterações

        </button>

      </div>

    </form>

  `);


  $("cancelEditDelivery").onclick =
    closeModal;


  $("edDeliveryHousehold").onchange =
    () => {

      const h =
        state.households.find(
          x =>
            x.id ===
            $("edDeliveryHousehold").value
        );

      if (h) {

        $("edDeliveryLiters").value =
          h.defaultLiters ||
          "";

      }

    };


  $("editDeliveryForm").onsubmit =
    async e => {

      e.preventDefault();

      try {

        const h =
          state.households.find(
            x =>
              x.id ===
              $("edDeliveryHousehold").value
          );

        if (!h) {

          toast(
            "Família não encontrada."
          );

          return;

        }


        const driverUid =
          $("edDeliveryDriver").value;


        const driver =
          state.drivers.find(
            x =>
              x.id ===
              driverUid
          );


        if (!driver) {

          toast(
            "Motorista não encontrado."
          );

          return;

        }


        await updateDoc(
          doc(
            db,
            "deliveries",
            id
          ),
          {

            householdId:
              h.id,

            recipientUid:
              h.recipientUid ||
              null,

            recipientEmail:
              h.recipientEmail ||
              h.email ||
              null,

            recipientName:
              h.name,

            address:
              h.address,

            community:
              h.community,

            recipientPhone:
              h.phone,

            scheduledDate:
              $("edDeliveryDate").value,

            plannedLiters:
              Number(
                $("edDeliveryLiters").value
              ),

            driverUid:
              driverUid,

            driverName:
              driver.name ||
              "Motorista",

            note:
              $("edDeliveryNote")
                .value
                .trim(),

            updatedAt:
              serverTimestamp(),

            updatedBy:
              state.user.uid

          }
        );


        closeModal();

        toast(
          "Entrega atualizada com sucesso."
        );

        await renderAdmin();

      } catch (error) {

        console.error(
          "Erro ao editar entrega:",
          error
        );

        toast(
          "Não foi possível atualizar a entrega."
        );

      }

    };

}


/* =========================================================
   PROGRAMAR ENTREGA
========================================================= */

async function showDeliveryForm() {

  if (!state.households.length) {

    toast(
      "Cadastre uma família primeiro."
    );

    return;

  }

  try {

    await loadDrivers();

  } catch (error) {

    toast(
      "Não foi possível carregar os motoristas."
    );

    return;

  }

  if (!state.drivers.length) {

    toast(
      "Nenhum motorista cadastrado foi encontrado."
    );

    return;

  }

  openModal(`

    <h2>
      Programar entrega
    </h2>


    <form id="deliveryForm">

      <label>
        Família

        <select id="dHousehold">

          ${
            state.households
              .filter(
                h =>
                  h.active !== false
              )
              .map(
                h =>
                  `<option value="${esc(h.id)}">
                    ${esc(h.name)}
                    —
                    ${esc(h.community)}
                  </option>`
              )
              .join("")
          }

        </select>

      </label>


      <label>
        Data

        <input
          id="dDate"
          type="date"
          required>

      </label>


      <label>
        Quantidade planejada (litros)

        <input
          id="dLiters"
          type="number"
          min="1"
          required>

      </label>


      <label>
        Motorista

        <select
          id="dDriverUid"
          required>

          <option
            value=""
            disabled
            selected>

            Selecione o motorista

          </option>

          ${
            state.drivers
              .filter(
                driver =>
                  driver.active !== false
              )
              .map(
                driver =>
                  `<option value="${esc(driver.id)}">
                    ${esc(
                      driver.name ||
                      "Motorista"
                    )}
                  </option>`
              )
              .join("")
          }

        </select>

      </label>


      <label>
        Observação

        <textarea
          id="dNote"></textarea>

      </label>


      <div class="actions">

        <button
          type="button"
          class="secondary"
          id="cancelNewDelivery">

          Cancelar

        </button>


        <button
          class="primary">

          Programar entrega

        </button>

      </div>

    </form>

  `);


  $("cancelNewDelivery").onclick =
    closeModal;


  $("dHousehold").onchange =
    () => {

      const h =
        state.households.find(
          x =>
            x.id ===
            $("dHousehold").value
        );

      $("dLiters").value =
        h?.defaultLiters ||
        "";

    };


  $("dHousehold")
    .dispatchEvent(
      new Event("change")
    );


  $("deliveryForm").onsubmit =
    async e => {

      e.preventDefault();

      try {

        const h =
          state.households.find(
            x =>
              x.id ===
              $("dHousehold").value
          );

        if (!h) {

          toast(
            "Família selecionada não encontrada."
          );

          return;

        }


        const driverUid =
          $("dDriverUid").value.trim();


        const driver =
          state.drivers.find(
            x =>
              x.id ===
              driverUid
          );


        if (!driver) {

          toast(
            "Selecione um motorista válido."
          );

          return;

        }


        await addDoc(
          collection(
            db,
            "deliveries"
          ),
          {

            householdId:
              h.id,

            recipientUid:
              h.recipientUid ||
              null,

            recipientEmail:
              h.recipientEmail ||
              h.email ||
              null,

            recipientName:
              h.name,

            address:
              h.address,

            community:
              h.community,

            recipientPhone:
              h.phone,

            scheduledDate:
              $("dDate").value,

            plannedLiters:
              Number(
                $("dLiters").value
              ),

            driverUid:
              driverUid,

            driverName:
              driver.name ||
              "Motorista",

            note:
              $("dNote")
                .value
                .trim(),

            status:
              "scheduled",

            createdAt:
              serverTimestamp(),

            createdBy:
              state.user.uid

          }
        );


        closeModal();

        toast(
          "Entrega programada com sucesso."
        );

        await renderAdmin();

      } catch (error) {

        console.error(
          "Erro ao programar entrega:",
          error
        );

        toast(
          "Não foi possível programar a entrega."
        );

      }

    };

}


/* =========================================================
   STATUS
========================================================= */

function statusLabel(s) {

  return ({

    scheduled:
      "Programada",

    awaiting_confirmation:
      "Aguardando confirmação",

    completed:
      "Concluída",

    absent:
      "Ninguém no local",

    cancelled:
      "Cancelada"

  })[s] || s || "—";

}


/* =========================================================
   MOTORISTA
========================================================= */

async function renderDriver() {

  let loadedFromFirebase =
    false;

  try {

    const q =
      query(
        collection(
          db,
          "deliveries"
        ),
        where(
          "driverUid",
          "==",
          state.user.uid
        ),
        limit(100)
      );

    const ds =
      await getDocs(q);

    state.deliveries =
      ds.docs
        .map(d => ({
          id: d.id,
          ...d.data()
        }))
        .sort((a, b) =>
          String(
            a.scheduledDate || ""
          ).localeCompare(
            String(
              b.scheduledDate || ""
            )
          )
        );

    loadedFromFirebase =
      true;

    await saveDriverDeliveriesToCache(
      state.deliveries
    );

  } catch (error) {

    console.warn(
      "Tentando cache offline:",
      error
    );

    state.deliveries =
      await getCachedDriverDeliveries(
        state.user.uid
      );

  }


  const offlineMessage =
    !navigator.onLine

      ? `

        <div class="notice">

          <b>Modo offline</b><br>

          Sem conexão com a internet.

        </div>

      `

      : loadedFromFirebase

        ? `

          <div class="notice">

            <b>Online</b><br>

            Entregas atualizadas pelo sistema.

          </div>

        `

        : `

          <div class="notice">

            <b>Modo offline</b><br>

            Foram carregados os dados
            salvos anteriormente neste aparelho.

          </div>

        `;


  $("driverPanel").innerHTML = `

    <div class="card">

      <div class="panel-title">

        <h2>
          Minhas entregas
        </h2>

      </div>


      ${offlineMessage}


      <div
        class="notice"
        style="margin-top:10px">

        Ao concluir, informe a quantidade
        realmente entregue.
        O fluxo de confirmação será ampliado
        nas próximas etapas.

      </div>


      ${
        !state.deliveries.length

          ? `

            <div
              class="notice"
              style="margin-top:14px">

              ${
                navigator.onLine
                  ? "Nenhuma entrega atribuída."
                  : "Nenhuma entrega disponível no cache."
              }

            </div>

          `

          : `

            <div
              class="grid"
              style="margin-top:14px">

              ${
                state.deliveries
                  .map(driverCard)
                  .join("")
              }

            </div>

          `

      }

    </div>

  `;


  document
    .querySelectorAll(
      "[data-complete]"
    )
    .forEach(b => {

      b.onclick =
        () =>
          showCompleteForm(
            b.dataset.complete
          );

    });

}


function driverCard(d) {

  const action =
    d.status === "scheduled"

      ? `

        <button
          class="primary"
          data-complete="${esc(d.id)}">

          Registrar entrega

        </button>

      `

      : "";


  return `

    <div class="item">

      <div class="row">

        <h3>
          ${esc(d.recipientName)}
        </h3>

        <span class="pill ${esc(d.status)}">
          ${statusLabel(d.status)}
        </span>

      </div>


      <p>

        <b>Quando:</b>
        ${esc(d.scheduledDate)}

        ·

        <b>Planejado:</b>
        ${esc(d.plannedLiters)} L

      </p>


      <p>

        <b>Comunidade:</b>
        ${esc(d.community)}

        <br>

        <b>Endereço:</b>
        ${esc(d.address)}

      </p>


      ${action}

    </div>

  `;

}


/* =========================================================
   REGISTRAR ENTREGA
========================================================= */

function showCompleteForm(id) {

  const d =
    state.deliveries.find(
      x => x.id === id
    );

  if (!d) {

    toast(
      "Entrega não encontrada."
    );

    return;

  }


  openModal(`

    <h2>
      Registrar fornecimento
    </h2>


    <div class="notice">

      Informe a quantidade realmente entregue
      e se havia alguém no local.

    </div>


    <form id="completeForm">

      <label>

        Quantidade realmente entregue
        (litros)

        <input
          id="cLiters"
          type="number"
          min="1"
          value="${esc(d.plannedLiters)}"
          required>

      </label>


      <label>

        Havia alguém no local?

        <select id="cPresence">

          <option value="yes">
            Sim — beneficiário presente
          </option>

          <option value="no">
            Não — ninguém no local
          </option>

        </select>

      </label>


      <div id="recipientFields">

        <label>
          PIN de confirmação do beneficiário

          <input
            id="cPin"
            inputmode="numeric"
            maxlength="8"
            placeholder="PIN do beneficiário">

        </label>


        <label>
          Assinatura do beneficiário
        </label>


        <canvas
          id="signature"
          class="signature">
        </canvas>


        <div class="actions">

          <button
            type="button"
            class="secondary"
            id="clearSig">

            Limpar assinatura

          </button>

        </div>

      </div>


      <div
        id="photoFields"
        class="hidden">

        <label>

          Foto de prova

          <input
            id="cPhoto"
            type="file"
            accept="image/*"
            capture="environment">

        </label>

      </div>


      <label>

        Observação

        <textarea
          id="cNote"></textarea>

      </label>


      <div class="actions">

        <button
          type="button"
          class="secondary"
          id="cancelComplete">

          Cancelar

        </button>

        <button
          class="primary">

          Finalizar fornecimento

        </button>

      </div>

    </form>

  `);


  $("cancelComplete").onclick =
    closeModal;


  const canvas =
    $("signature");

  const ctx =
    canvas.getContext("2d");

  let drawing =
    false;


  function resize() {

    const r =
      canvas.getBoundingClientRect();

    canvas.width =
      r.width *
      devicePixelRatio;

    canvas.height =
      r.height *
      devicePixelRatio;

    ctx.scale(
      devicePixelRatio,
      devicePixelRatio
    );

    ctx.lineWidth =
      2;

    ctx.lineCap =
      "round";

    ctx.strokeStyle =
      "#172033";

  }


  resize();


  function pos(e) {

    const r =
      canvas.getBoundingClientRect();

    const p =
      e.touches
        ? e.touches[0]
        : e;

    return [
      p.clientX - r.left,
      p.clientY - r.top
    ];

  }


  const start =
    e => {

      drawing =
        true;

      const [x, y] =
        pos(e);

      ctx.beginPath();

      ctx.moveTo(
        x,
        y
      );

      e.preventDefault();

    };


  const move =
    e => {

      if (!drawing)
        return;

      const [x, y] =
        pos(e);

      ctx.lineTo(
        x,
        y
      );

      ctx.stroke();

      e.preventDefault();

    };


  const end =
    () =>
      drawing = false;


  canvas.addEventListener(
    "mousedown",
    start
  );

  canvas.addEventListener(
    "mousemove",
    move
  );

  canvas.addEventListener(
    "mouseup",
    end
  );

  canvas.addEventListener(
    "touchstart",
    start,
    {
      passive: false
    }
  );

  canvas.addEventListener(
    "touchmove",
    move,
    {
      passive: false
    }
  );

  canvas.addEventListener(
    "touchend",
    end
  );


  $("clearSig").onclick =
    () =>
      ctx.clearRect(
        0,
        0,
        canvas.width,
        canvas.height
      );


  $("cPresence").onchange =
    () => {

      const yes =
        $("cPresence").value ===
        "yes";

      $("recipientFields")
        .classList
        .toggle(
          "hidden",
          !yes
        );

      $("photoFields")
        .classList
        .toggle(
          "hidden",
          yes
        );

    };


  $("completeForm").onsubmit =
    async e => {

      e.preventDefault();

      try {

        const present =
          $("cPresence").value ===
          "yes";


        if (
          present &&
          $("cPin").value.trim() !==
          String(
            d.confirmationPin ||
            ""
          )
        ) {

          toast(
            "PIN de confirmação incorreto."
          );

          return;

        }


        if (
          present &&
          isBlankCanvas(canvas)
        ) {

          toast(
            "Faça a assinatura do beneficiário."
          );

          return;

        }


        if (
          !present &&
          !$("cPhoto").files[0]
        ) {

          toast(
            "A foto é obrigatória quando não há ninguém no local."
          );

          return;

        }


        let photoUrl =
          null;

        let signatureData =
          null;


        if (present) {

          signatureData =
            canvas.toDataURL(
              "image/png"
            );

        } else {

          const file =
            $("cPhoto").files[0];

          const path =
            `delivery-proof/${id}/${Date.now()}-${file.name.replace(
              /[^a-zA-Z0-9._-]/g,
              "_"
            )}`;

          const snap =
            await uploadBytes(
              ref(
                storage,
                path
              ),
              file,
              {
                contentType:
                  file.type
              }
            );

          photoUrl =
            await getDownloadURL(
              snap.ref
            );

        }


        await updateDoc(
          doc(
            db,
            "deliveries",
            id
          ),
          {

            status:
              present
                ? "completed"
                : "absent",

            receivedLiters:
              Number(
                $("cLiters").value
              ),

            recipientPresent:
              present,

            signatureData,
            photoUrl,

            note:
              $("cNote")
                .value
                .trim(),

            completedAt:
              serverTimestamp(),

            completedBy:
              state.user.uid

          }
        );


        closeModal();

        toast(
          "Fornecimento registrado."
        );

        await renderDriver();

      } catch (error) {

        console.error(
          "Erro ao registrar fornecimento:",
          error
        );

        toast(
          "Não foi possível registrar o fornecimento."
        );

      }

    };

}


/* =========================================================
   ASSINATURA
========================================================= */

function isBlankCanvas(c) {

  const data =
    c.getContext("2d")
      .getImageData(
        0,
        0,
        c.width,
        c.height
      ).data;

  for (
    let i = 3;
    i < data.length;
    i += 4
  ) {

    if (
      data[i] > 0
    )
      return false;

  }

  return true;

}


/* =========================================================
   BENEFICIÁRIO
========================================================= */

async function renderRecipient() {

  let list = [];


  /*
    NOVO MÉTODO:
    procura primeiro pelo UID do beneficiário.
  */

  if (state.profile.householdId) {

    try {

      const q =
        query(
          collection(
            db,
            "deliveries"
          ),
          where(
            "recipientUid",
            "==",
            state.user.uid
          ),
          limit(50)
        );

      const ds =
        await getDocs(q);

      list =
        ds.docs
          .map(d => ({
            id: d.id,
            ...d.data()
          }));

    } catch (error) {

      console.warn(
        "Não foi possível carregar entregas pelo UID:",
        error
      );

    }

  }


  /*
    TAMBÉM TENTA PELO UID,
    MESMO QUE O householdId AINDA NÃO ESTEJA
    DISPONÍVEL NO PERFIL.
  */

  if (!list.length) {

    try {

      const q =
        query(
          collection(
            db,
            "deliveries"
          ),
          where(
            "recipientUid",
            "==",
            state.user.uid
          ),
          limit(50)
        );

      const ds =
        await getDocs(q);

      list =
        ds.docs
          .map(d => ({
            id: d.id,
            ...d.data()
          }));

    } catch (error) {

      console.warn(
        "Erro ao carregar abastecimentos pelo UID:",
        error
      );

    }

  }


  /*
    COMPATIBILIDADE COM OS CADASTROS ANTIGOS:
    SE NÃO ENCONTRAR PELO UID, USA O TELEFONE.
  */

  if (
    !list.length &&
    state.profile.phone
  ) {

    try {

      const q =
        query(
          collection(
            db,
            "deliveries"
          ),
          where(
            "recipientPhone",
            "==",
            state.profile.phone
          ),
          limit(50)
        );

      const ds =
        await getDocs(q);

      list =
        ds.docs
          .map(d => ({
            id: d.id,
            ...d.data()
          }));

    } catch (error) {

      console.error(
        "Erro ao carregar abastecimentos:",
        error
      );

    }

  }


  list =
    list.sort((a, b) =>
      String(
        b.scheduledDate || ""
      ).localeCompare(
        String(
          a.scheduledDate || ""
        )
      )
    );


  $("recipientPanel").innerHTML = `

    <div class="card">

      <div class="panel-title">

        <h2>
          Meu abastecimento
        </h2>

      </div>


      <div class="notice">

        Confira data, quantidade e situação
        de cada fornecimento.

      </div>


      <div
        class="grid"
        style="margin-top:14px">

        ${
          list
            .map(recipientCard)
            .join("")
          ||
          "<p class='small'>Nenhum fornecimento localizado.</p>"
        }

      </div>

    </div>

  `;

}


function recipientCard(d) {

  return `

    <div class="item">

      <div class="row">

        <h3>
          ${esc(d.scheduledDate)}
        </h3>

        <span class="pill ${esc(d.status)}">

          ${statusLabel(d.status)}

        </span>

      </div>


      <p>

        <b>
          Quantidade programada:
        </b>

        ${esc(d.plannedLiters)} L

      </p>


      <p>

        <b>
          Quantidade registrada:
        </b>

        ${
          d.receivedLiters !== undefined &&
          d.receivedLiters !== null
            ? `${esc(d.receivedLiters)} L`
            : "Ainda não registrada"
        }

      </p>


      <p>

        <b>
          Local:
        </b>

        ${esc(d.address)}

      </p>

    </div>

  `;

}
