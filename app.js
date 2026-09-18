```javascript
import {
  auth,
  db,
  storage
} from "./firebase-config.js";

import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
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


/* =========================
   ESTADO DO APLICATIVO
========================= */

const $ = (id) => document.getElementById(id);

const state = {
  user: null,
  profile: null,
  households: [],
  deliveries: [],
  syncing: false
};


/* =========================
   BANCO LOCAL - INDEXEDDB
========================= */

const LOCAL_DB_NAME = "agua-para-todos-offline";
const LOCAL_DB_VERSION = 1;

const STORE_DELIVERIES = "deliveries";
const STORE_QUEUE = "syncQueue";


function openLocalDatabase() {

  return new Promise((resolve, reject) => {

    const request =
      indexedDB.open(
        LOCAL_DB_NAME,
        LOCAL_DB_VERSION
      );


    request.onupgradeneeded = () => {

      const database =
        request.result;


      if (
        !database.objectStoreNames.contains(
          STORE_DELIVERIES
        )
      ) {

        database.createObjectStore(
          STORE_DELIVERIES,
          {
            keyPath: "id"
          }
        );

      }


      if (
        !database.objectStoreNames.contains(
          STORE_QUEUE
        )
      ) {

        database.createObjectStore(
          STORE_QUEUE,
          {
            keyPath: "localId"
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

  });

}


async function localPut(
  storeName,
  data
) {

  const database =
    await openLocalDatabase();


  return new Promise(
    (resolve, reject) => {

      const transaction =
        database.transaction(
          storeName,
          "readwrite"
        );


      transaction.objectStore(
        storeName
      ).put(data);


      transaction.oncomplete =
        () => {

          database.close();

          resolve();

        };


      transaction.onerror =
        () => {

          database.close();

          reject(
            transaction.error
          );

        };

    }
  );

}


async function localGet(
  storeName,
  key
) {

  const database =
    await openLocalDatabase();


  return new Promise(
    (resolve, reject) => {

      const transaction =
        database.transaction(
          storeName,
          "readonly"
        );


      const request =
        transaction
          .objectStore(storeName)
          .get(key);


      request.onsuccess =
        () => {

          database.close();

          resolve(
            request.result
          );

        };


      request.onerror =
        () => {

          database.close();

          reject(
            request.error
          );

        };

    }
  );

}


async function localGetAll(
  storeName
) {

  const database =
    await openLocalDatabase();


  return new Promise(
    (resolve, reject) => {

      const transaction =
        database.transaction(
          storeName,
          "readonly"
        );


      const request =
        transaction
          .objectStore(storeName)
          .getAll();


      request.onsuccess =
        () => {

          database.close();

          resolve(
            request.result || []
          );

        };


      request.onerror =
        () => {

          database.close();

          reject(
            request.error
          );

        };

    }
  );

}


async function localDelete(
  storeName,
  key
) {

  const database =
    await openLocalDatabase();


  return new Promise(
    (resolve, reject) => {

      const transaction =
        database.transaction(
          storeName,
          "readwrite"
        );


      transaction.objectStore(
        storeName
      ).delete(key);


      transaction.oncomplete =
        () => {

          database.close();

          resolve();

        };


      transaction.onerror =
        () => {

          database.close();

          reject(
            transaction.error
          );

        };

    }
  );

}


/* =========================
   CACHE DE ENTREGAS
========================= */

async function cacheDelivery(
  delivery
) {

  try {

    await localPut(
      STORE_DELIVERIES,
      delivery
    );

  } catch (error) {

    console.error(
      "Erro ao salvar entrega no aparelho:",
      error
    );

  }

}


async function cacheDeliveries(
  deliveries
) {

  for (
    const delivery of deliveries
  ) {

    await cacheDelivery(
      delivery
    );

  }

}


async function getCachedDriverDeliveries() {

  if (!state.user) {
    return [];
  }


  const all =
    await localGetAll(
      STORE_DELIVERIES
    );


  return all
    .filter(
      d =>
        d.driverUid ===
        state.user.uid
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

}


/* =========================
   FILA DE SINCRONIZAÇÃO
========================= */

function createLocalId() {

  return (
    "offline-" +
    Date.now() +
    "-" +
    Math.random()
      .toString(36)
      .slice(2, 10)
  );

}


async function addSyncQueue(
  item
) {

  await localPut(
    STORE_QUEUE,
    item
  );

}


async function getSyncQueue() {

  return localGetAll(
    STORE_QUEUE
  );

}


async function getPendingCount() {

  try {

    const queue =
      await getSyncQueue();

    return queue.length;

  } catch (error) {

    console.error(
      "Erro ao contar pendências:",
      error
    );

    return 0;

  }

}


/* =========================
   INDICADOR DE CONEXÃO
========================= */

async function updateConnectionStatus() {

  const element =
    $("connectionStatus");


  if (!element) {
    return;
  }


  const pending =
    await getPendingCount();


  element.classList.remove(
    "ok"
  );


  if (state.syncing) {

    element.textContent =
      pending > 0
        ? `Sincronizando ${pending} registro(s)...`
        : "Sincronizando...";

    return;

  }


  if (!navigator.onLine) {

    element.textContent =
      pending > 0
        ? `Sem internet · ${pending} pendente(s)`
        : "Sem internet";

    return;

  }


  if (pending > 0) {

    element.textContent =
      `Online · ${pending} pendente(s)`;

    element.classList.add(
      "ok"
    );

    return;

  }


  element.textContent =
    "Online · sincronizado";

  element.classList.add(
    "ok"
  );

}


window.addEventListener(
  "online",
  async () => {

    console.log(
      "Internet detectada novamente."
    );


    await updateConnectionStatus();


    if (state.user) {

      toast(
        "Internet voltou. Sincronizando registros..."
      );


      await syncPendingRecords();


      if (
        state.profile?.role ===
        "driver"
      ) {

        await renderDriver();

      }

    }

  }
);


window.addEventListener(
  "offline",
  async () => {

    console.log(
      "Dispositivo ficou sem internet."
    );


    await updateConnectionStatus();


    toast(
      "Sem internet. Os registros continuarão salvos no aparelho."
    );

  }
);


/* =========================
   SINCRONIZAÇÃO
========================= */

async function syncPendingRecords() {

  if (
    state.syncing ||
    !navigator.onLine ||
    !state.user
  ) {

    await updateConnectionStatus();

    return;

  }


  const queue =
    await getSyncQueue();


  if (!queue.length) {

    await updateConnectionStatus();

    return;

  }


  state.syncing = true;

  await updateConnectionStatus();


  let successCount = 0;


  try {

    for (
      const item of queue
    ) {

      try {

        await syncSingleRecord(
          item
        );


        await localDelete(
          STORE_QUEUE,
          item.localId
        );


        successCount++;

      } catch (error) {

        console.error(
          "Falha ao sincronizar registro:",
          item.localId,
          error
        );

        /*
          NÃO apagamos o registro.
          Ele continua na fila para
          uma nova tentativa.
        */

      }

    }

  } finally {

    state.syncing = false;

  }


  await updateConnectionStatus();


  if (successCount > 0) {

    toast(
      `${successCount} registro(s) sincronizado(s) com sucesso.`
    );

  }


  if (
    state.profile?.role ===
    "driver"
  ) {

    await refreshDriverFromServer();

  }

}


async function syncSingleRecord(
  item
) {

  const {
    deliveryId,
    receivedLiters,
    recipientPresent,
    signatureData,
    photoBlob,
    photoName,
    photoType,
    note,
    recordedAt,
    driverUid
  } = item;


  if (
    driverUid !==
    state.user.uid
  ) {

    throw new Error(
      "Este registro pertence a outro motorista."
    );

  }


  let photoUrl =
    null;


  /*
    Se houver foto, primeiro fazemos
    o upload para o Firebase Storage.
  */

  if (photoBlob) {

    const safeName =
      String(
        photoName ||
        "comprovacao.jpg"
      ).replace(
        /[^a-zA-Z0-9._-]/g,
        "_"
      );


    const path =
      `delivery-proof/${deliveryId}/${Date.now()}-${safeName}`;


    const snap =
      await uploadBytes(
        ref(
          storage,
          path
        ),
        photoBlob,
        {
          contentType:
            photoType ||
            photoBlob.type ||
            "image/jpeg"
        }
      );


    photoUrl =
      await getDownloadURL(
        snap.ref
      );

  }


  /*
    Agora atualizamos a entrega
    no Firestore.
  */

  const deliveryRef =
    doc(
      db,
      "deliveries",
      deliveryId
    );


  const deliverySnapshot =
    await getDoc(
      deliveryRef
    );


  if (
    !deliverySnapshot.exists()
  ) {

    throw new Error(
      "A entrega não existe mais no Firebase."
    );

  }


  const current =
    deliverySnapshot.data();


  /*
    Proteção contra duplicidade:
    se a entrega já estiver concluída
    no servidor, não gravamos novamente.
  */

  if (
    current.status ===
      "completed" ||
    current.status ===
      "absent"
  ) {

    await localPut(
      STORE_DELIVERIES,
      {
        id: deliveryId,
        ...current
      }
    );


    return;

  }


  await updateDoc(
    deliveryRef,
    {

      status:
        recipientPresent
          ? "completed"
          : "absent",

      receivedLiters:
        Number(
          receivedLiters
        ),

      recipientPresent:
        Boolean(
          recipientPresent
        ),

      signatureData:
        signatureData ||
        null,

      photoUrl:
        photoUrl,

      note:
        note ||
        "",

      completedAt:
        serverTimestamp(),

      completedBy:
        driverUid,

      offlineRecordedAt:
        recordedAt ||
        null,

      syncedAt:
        serverTimestamp(),

      syncOrigin:
        "offline"

    }
  );


  /*
    Atualiza também o cache local.
  */

  await localPut(
    STORE_DELIVERIES,
    {
      id: deliveryId,
      ...current,

      status:
        recipientPresent
          ? "completed"
          : "absent",

      receivedLiters:
        Number(
          receivedLiters
        ),

      recipientPresent:
        Boolean(
          recipientPresent
        ),

      signatureData:
        signatureData ||
        null,

      photoUrl:
        photoUrl,

      note:
        note ||
        "",

      completedBy:
        driverUid

    }
  );

}


/* =========================
   EVENTOS PRINCIPAIS
========================= */

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


/* =========================
   FUNÇÕES GERAIS
========================= */

function toast(msg) {

  if (!$("toast")) {
    return;
  }


  $("toast").textContent =
    msg;


  $("toast").classList.add(
    "show"
  );


  setTimeout(
    () => {

      $("toast").classList.remove(
        "show"
      );

    },
    3500
  );

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
      })[m]
  );

}


function fmtDate(ts) {

  if (!ts) {
    return "—";
  }


  const d =
    ts.toDate
      ? ts.toDate()
      : new Date(ts);


  return d.toLocaleString(
    "pt-BR"
  );

}


function dateOnly(v) {

  if (!v) {
    return "—";
  }


  return new Date(
    v + "T12:00:00"
  ).toLocaleDateString(
    "pt-BR"
  );

}


/* =========================
   LOGIN
========================= */

if ($("loginForm")) {

  $("loginForm").onsubmit =
    async e => {

      e.preventDefault();

      $("loginMsg").textContent =
        "";

      try {

        await signInWithEmailAndPassword(
          auth,
          $("loginEmail").value.trim(),
          $("loginPassword").value
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
      "Muitas tentativas. Aguarde alguns minutos."

  };


  return (
    m[err.code] ||
    "Não foi possível entrar. Verifique os dados."
  );

}


/* =========================
   AUTENTICAÇÃO
========================= */

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


    await updateConnectionStatus();


    try {

      console.log(
        "Usuário autenticado:",
        user.uid
      );


      const p =
        await getDoc(
          doc(
            db,
            "users",
            user.uid
          )
        );


      if (!p.exists()) {

        console.error(
          "Perfil não encontrado para UID:",
          user.uid
        );


        toast(
          "Usuário autenticado, mas sem perfil cadastrado."
        );


        return;

      }


      state.profile = {

        id:
          p.id,

        ...p.data()

      };


      console.log(
        "Perfil carregado:",
        state.profile
      );


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


      /*
        Quando o motorista entra com internet,
        carregamos as entregas e guardamos
        uma cópia local para uso posterior
        sem internet.
      */

      if (
        state.profile.role ===
        "driver"
      ) {

        await refreshDriverFromServer()
          .catch(
            error => {

              console.warn(
                "Não foi possível atualizar do servidor:",
                error
              );

            }
          );


        await syncPendingRecords();

      }


      await renderByRole();


    } catch (e) {

      console.error(
        "ERRO AO CARREGAR PERFIL/APLICATIVO:",
        e
      );


      /*
        Se estiver sem internet e já houver
        dados locais do motorista, permitimos
        continuar.
      */

      if (
        state.profile?.role ===
        "driver"
      ) {

        try {

          const cached =
            await getCachedDriverDeliveries();


          if (cached.length) {

            state.deliveries =
              cached;


            await renderDriver();

            toast(
              "Sem internet. Usando os dados salvos no aparelho."
            );

            return;

          }

        } catch (
          offlineError
        ) {

          console.error(
            "Erro ao recuperar dados offline:",
            offlineError
          );

        }

      }


      toast(
        "Erro ao carregar seu perfil."
      );

    }

  }
);


/* =========================
   PERFIS
========================= */

function roleLabel(r) {

  return ({
    admin:
      "Administrador",

    driver:
      "Motorista",

    recipient:
      "Beneficiário"

  })[r] ||
    r ||
    "Usuário";

}


async function renderByRole() {

  [
    "adminPanel",
    "driverPanel",
    "recipientPanel"
  ].forEach(
    id => {

      if ($(id)) {

        $(id)
          .classList
          .add("hidden");

      }

    }
  );


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


/* =========================
   ADMINISTRADOR
========================= */

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
        .map(
          d => ({
            id: d.id,
            ...d.data()
          })
        )
        .sort(
          (a, b) =>
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
        .map(
          d => ({
            id: d.id,
            ...d.data()
          })
        )
        .sort(
          (a, b) =>
            String(
              b.scheduledDate || ""
            ).localeCompare(
              String(
                a.scheduledDate || ""
              )
            )
        );


    const pending =
      state.deliveries.filter(
        x =>
          x.status ===
          "scheduled"
      ).length;


    const done =
      state.deliveries.filter(
        x =>
          x.status ===
          "completed"
      ).length;


    $("adminPanel").innerHTML = `

      <div class="card">

        <div class="panel-title">

          <h2>
            Painel administrativo
          </h2>

          <div class="actions">

            <button
              class="primary"
              id="newHousehold">
              + Cadastrar família
            </button>

            <button
              class="yellow"
              id="newDelivery">
              + Programar entrega
            </button>

          </div>

        </div>


        <div class="stats">

          <div class="stat">

            <b>
              ${state.households.length}
            </b>

            famílias

          </div>


          <div class="stat">

            <b>
              ${pending}
            </b>

            programadas

          </div>


          <div class="stat">

            <b>
              ${done}
            </b>

            concluídas

          </div>

        </div>

      </div>


      <div class="card">

        <div class="panel-title">

          <h2>
            Famílias cadastradas
          </h2>

        </div>


        <div class="grid">

          ${
            state.households
              .map(
                householdCard
              )
              .join("")
            ||
            "<p class='small'>Nenhuma família cadastrada.</p>"
          }

        </div>

      </div>


      <div class="card">

        <div class="panel-title">

          <h2>
            Últimas entregas
          </h2>

        </div>


        <div class="grid">

          ${
            state.deliveries
              .slice(0, 30)
              .map(
                deliveryCard
              )
              .join("")
            ||
            "<p class='small'>Nenhuma entrega registrada.</p>"
          }

        </div>

      </div>

    `;


    $("newHousehold").onclick =
      showHouseholdForm;


    $("newDelivery").onclick =
      showDeliveryForm;


    document
      .querySelectorAll(
        "[data-edit-household]"
      )
      .forEach(
        button => {

          button.onclick =
            () =>
              showEditHouseholdForm(
                button.dataset
                  .editHousehold
              );

        }
      );


    document
      .querySelectorAll(
        "[data-view-delivery]"
      )
      .forEach(
        button => {

          button.onclick =
            () =>
              showDeliveryDetails(
                button.dataset
                  .viewDelivery
              );

        }
      );


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
          Não foi possível carregar os dados
          administrativos.
        </p>

        <p class="small">
          Detalhes:
          ${esc(error.message)}
        </p>

      </div>

    `;


    throw error;

  }

}


/* =========================
   CARTÃO DA FAMÍLIA
========================= */

function householdCard(h) {

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

        <b>
          Telefone:
        </b>

        ${esc(
          h.phone ||
          "—"
        )}

        ${
          h.cpf
            ? ` · <b>CPF:</b> ${esc(h.cpf)}`
            : ""
        }

      </p>


      <p>

        <b>
          Comunidade:
        </b>

        ${esc(
          h.community ||
          "—"
        )}

      </p>


      <p>

        <b>
          Endereço:
        </b>

        ${esc(
          h.address ||
          "—"
        )}

      </p>


      <p>

        <b>
          Pessoas:
        </b>

        ${esc(
          h.people ||
          "—"
        )}

        ·

        <b>
          Frequência:
        </b>

        ${esc(
          h.frequency ||
          "—"
        )}

        ·

        <b>
          Litros:
        </b>

        ${esc(
          h.defaultLiters ||
          "—"
        )}
        L

      </p>


      <div class="actions">

        <button
          class="secondary"
          data-edit-household="${esc(h.id)}">

          Editar cadastro

        </button>

      </div>

    </div>

  `;

}


/* =========================
   CARTÃO DA ENTREGA
========================= */

function deliveryCard(d) {

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

        <b>
          Data:
        </b>

        ${esc(
          d.scheduledDate ||
          "—"
        )}

        ·

        <b>
          Quantidade:
        </b>

        ${esc(
          d.plannedLiters ||
          "—"
        )} L

      </p>


      <p>

        <b>
          Local:
        </b>

        ${esc(
          d.address ||
          "—"
        )}

        ·

        <b>
          Motorista:
        </b>

        ${esc(
          d.driverName ||
          "—"
        )}

      </p>


      ${
        d.completedAt

          ? `

            <p>

              <b>
                Concluída:
              </b>

              ${fmtDate(
                d.completedAt
              )}

              ·

              <b>
                Recebido:
              </b>

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

          Ver detalhes

        </button>

      </div>

    </div>

  `;

}


/* =========================
   DETALHES DA ENTREGA
========================= */

async function showDeliveryDetails(
  id
) {

  try {

    const deliveryRef =
      doc(
        db,
        "deliveries",
        id
      );


    const deliverySnapshot =
      await getDoc(
        deliveryRef
      );


    if (
      !deliverySnapshot.exists()
    ) {

      toast(
        "Entrega não encontrada."
      );

      return;

    }


    const d = {

      id:
        deliverySnapshot.id,

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

          <div
            style="margin-top:18px;">

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
                src="${esc(
                  d.signatureData
                )}"
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

          <div
            style="margin-top:18px;">

            <h3>
              Foto de comprovação
            </h3>


            <div
              style="
                background:#ffffff;
                border:1px solid #ddd;
                border-radius:10px;
                padding:10px;
              ">

              <img
                src="${esc(
                  d.photoUrl
                )}"
                alt="Foto de comprovação da entrega"
                style="
                  display:block;
                  width:100%;
                  max-width:600px;
                  height:auto;
                  border-radius:8px;
                ">


              <p
                style="margin-top:10px;">

                <a
                  href="${esc(
                    d.photoUrl
                  )}"
                  target="_blank"
                  rel="noopener noreferrer">

                  Abrir foto em tamanho maior

                </a>

              </p>

            </div>

          </div>

        `

        : "";


    openModal(`

      <h2>
        Detalhes da entrega
      </h2>


      <div class="notice">

        <b>
          Situação:
        </b>

        ${esc(
          statusLabel(
            d.status
          )
        )}

      </div>


      <div class="item">

        <h3>
          Beneficiário
        </h3>


        <p>

          <b>
            Nome:
          </b>

          ${esc(
            d.recipientName ||
            "—"
          )}

        </p>


        <p>

          <b>
            Telefone:
          </b>

          ${esc(
            d.recipientPhone ||
            "—"
          )}

        </p>

      </div>


      <div class="item">

        <h3>
          Local do abastecimento
        </h3>


        <p>

          <b>
            Comunidade:
          </b>

          ${esc(
            d.community ||
            "—"
          )}

        </p>


        <p>

          <b>
            Endereço / referência:
          </b>

          ${esc(
            d.address ||
            "—"
          )}

        </p>

      </div>


      <div class="item">

        <h3>
          Programação
        </h3>


        <p>

          <b>
            Data programada:
          </b>

          ${esc(
            d.scheduledDate ||
            "—"
          )}

        </p>


        <p>

          <b>
            Quantidade planejada:
          </b>

          ${esc(
            d.plannedLiters ||
            "—"
          )} L

        </p>


        <p>

          <b>
            Motorista:
          </b>

          ${esc(
            d.driverName ||
            "—"
          )}

        </p>


        <p>

          <b>
            UID do motorista:
          </b>

          ${esc(
            d.driverUid ||
            "—"
          )}

        </p>

      </div>


      <div class="item">

        <h3>
          Resultado do abastecimento
        </h3>


        <p>

          <b>
            Quantidade realmente entregue:
          </b>

          ${
            d.receivedLiters !==
              undefined &&
            d.receivedLiters !==
              null

              ? `${esc(
                  d.receivedLiters
                )} L`

              : "Ainda não registrada"
          }

        </p>


        <p>

          <b>
            Beneficiário presente:
          </b>

          ${presentText}

        </p>


        <p>

          <b>
            Data/hora da conclusão:
          </b>

          ${fmtDate(
            d.completedAt
          )}

        </p>


        <p>

          <b>
            UID de quem registrou:
          </b>

          ${esc(
            d.completedBy ||
            "—"
          )}

        </p>


        <p>

          <b>
            Observação:
          </b>

          ${esc(
            d.note ||
            "Nenhuma"
          )}

        </p>

      </div>


      ${signatureHtml}

      ${photoHtml}


      <div class="item">

        <h3>
          Controle do registro
        </h3>


        <p>

          <b>
            ID da entrega:
          </b>

          ${esc(
            d.id
          )}

        </p>


        <p>

          <b>
            Criada em:
          </b>

          ${fmtDate(
            d.createdAt
          )}

        </p>


        <p>

          <b>
            Criada pelo UID:
          </b>

          ${esc(
            d.createdBy ||
            "—"
          )}

        </p>


        ${
          d.syncOrigin ===
          "offline"

            ? `

              <p>

                <b>
                  Origem do registro:
                </b>

                Registrado offline
                e sincronizado
                posteriormente.

              </p>

            `

            : ""
        }

      </div>


      <div class="actions">

        <button
          type="button"
          class="primary"
          id="closeDeliveryDetails">

          Fechar

        </button>

      </div>

    `);


    if (
      $("closeDeliveryDetails")
    ) {

      $("closeDeliveryDetails")
        .onclick =
        closeModal;

    }


  } catch (error) {

    console.error(
      "Erro ao carregar detalhes da entrega:",
      error
    );


    toast(
      "Não foi possível carregar os detalhes da entrega."
    );

  }

}


function statusLabel(s) {

  return ({

    scheduled:
      "Programada",

    completed:
      "Concluída",

    absent:
      "Ninguém no local",

    cancelled:
      "Cancelada"

  })[s] ||
    s ||
    "—";

}


/* =========================
   CADASTRAR FAMÍLIA
========================= */

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
          required>

      </label>


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

          <option>
            Semanal
          </option>

          <option>
            Quinzenal
          </option>

          <option>
            Mensal
          </option>

          <option>
            Conforme necessidade
          </option>

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


      <button
        class="primary">

        Salvar família

      </button>

    </form>

  `);


  $("householdForm").onsubmit =
    async e => {

      e.preventDefault();


      try {

        await addDoc(
          collection(
            db,
            "households"
          ),
          {

            name:
              $("hName")
                .value
                .trim(),

            cpf:
              $("hCpf")
                .value
                .trim(),

            phone:
              $("hPhone")
                .value
                .trim(),

            community:
              $("hCommunity")
                .value
                .trim(),

            address:
              $("hAddress")
                .value
                .trim(),

            people:
              Number(
                $("hPeople").value
              ),

            frequency:
              $("hFreq").value,

            defaultLiters:
              Number(
                $("hLiters").value
              ),

            active:
              true,

            createdAt:
              serverTimestamp(),

            createdBy:
              state.user.uid

          }
        );


        closeModal();


        toast(
          "Família cadastrada."
        );


        await renderAdmin();


      } catch (error) {

        console.error(
          "Erro ao cadastrar família:",
          error
        );


        toast(
          "Não foi possível cadastrar a família."
        );

      }

    };

}


/* =========================
   EDITAR FAMÍLIA
========================= */

function showEditHouseholdForm(
  id
) {

  const h =
    state.households.find(
      x =>
        x.id === id
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
          value="${esc(
            h.name ||
            ""
          )}"
          required>

      </label>


      <label>

        CPF

        <input
          id="ehCpf"
          inputmode="numeric"
          value="${esc(
            h.cpf ||
            ""
          )}">

      </label>


      <label>

        Telefone

        <input
          id="ehPhone"
          value="${esc(
            h.phone ||
            ""
          )}"
          required>

      </label>


      <label>

        Comunidade / zona rural

        <input
          id="ehCommunity"
          value="${esc(
            h.community ||
            ""
          )}"
          required>

      </label>


      <label>

        Endereço / referência

        <input
          id="ehAddress"
          value="${esc(
            h.address ||
            ""
          )}"
          required>

      </label>


      <label>

        Quantidade de pessoas

        <input
          id="ehPeople"
          type="number"
          min="1"
          value="${esc(
            h.people ||
            1
          )}"
          required>

      </label>


      <label>

        Frequência

        <select id="ehFreq">

          <option
            ${
              h.frequency ===
              "Semanal"
                ? "selected"
                : ""
            }>

            Semanal

          </option>


          <option
            ${
              h.frequency ===
              "Quinzenal"
                ? "selected"
                : ""
            }>

            Quinzenal

          </option>


          <option
            ${
              h.frequency ===
              "Mensal"
                ? "selected"
                : ""
            }>

            Mensal

          </option>


          <option
            ${
              h.frequency ===
              "Conforme necessidade"
                ? "selected"
                : ""
            }>

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
          value="${esc(
            h.defaultLiters ||
            ""
          )}"
          required>

      </label>


      <label>

        Situação

        <select id="ehActive">

          <option
            value="true"
            ${
              h.active !== false
                ? "selected"
                : ""
            }>

            Ativa

          </option>


          <option
            value="false"
            ${
              h.active === false
                ? "selected"
                : ""
            }>

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


  $("editHouseholdForm")
    .onsubmit =
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
              $("ehName")
                .value
                .trim(),

            cpf:
              $("ehCpf")
                .value
                .trim(),

            phone:
              $("ehPhone")
                .value
                .trim(),

            community:
              $("ehCommunity")
                .value
                .trim(),

            address:
              $("ehAddress")
                .value
                .trim(),

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
          "Cadastro atualizado."
        );


        await renderAdmin();


      } catch (error) {

        console.error(
          "Erro ao atualizar cadastro:",
          error
        );


        toast(
          "Não foi possível atualizar o cadastro."
        );

      }

    };

}


/* =========================
   PROGRAMAR ENTREGA
========================= */

async function showDeliveryForm() {

  if (
    !state.households.length
  ) {

    toast(
      "Cadastre uma família primeiro."
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

        Quantidade planejada
        (litros)

        <input
          id="dLiters"
          type="number"
          min="1"
          required>

      </label>


      <label>

        Motorista
        (UID do usuário)

        <input
          id="dDriverUid"
          placeholder="Cole o UID do motorista"
          required>

      </label>


      <label>

        Observação

        <textarea
          id="dNote">
        </textarea>

      </label>


      <button
        class="primary">

        Programar entrega

      </button>

    </form>

  `);


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
      new Event(
        "change"
      )
    );


  $("deliveryForm")
    .onsubmit =
    async e => {

      e.preventDefault();


      try {

        const h =
          state.households.find(
            x =>
              x.id ===
              $("dHousehold").value
          );


        const driverUid =
          $("dDriverUid")
            .value
            .trim();


        const du =
          await getDoc(
            doc(
              db,
              "users",
              driverUid
            )
          );


        if (
          !du.exists() ||
          du.data().role !==
            "driver"
        ) {

          toast(
            "UID do motorista inválido ou sem perfil de motorista."
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
              du.data().name ||
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
          "Entrega programada."
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


/* =========================
   MOTORISTA
========================= */

async function refreshDriverFromServer() {

  if (!state.user) {
    return;
  }


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
      .map(
        d => ({
          id: d.id,
          ...d.data()
        })
      )
      .sort(
        (a, b) =>
          String(
            a.scheduledDate ||
            ""
          ).localeCompare(
            String(
              b.scheduledDate ||
              ""
            )
          )
      );


  await cacheDeliveries(
    state.deliveries
  );


  return state.deliveries;

}


async function renderDriver() {

  try {

    /*
      Primeiro tentamos usar o servidor
      quando há internet.
    */

    if (navigator.onLine) {

      try {

        await refreshDriverFromServer();

      } catch (error) {

        console.warn(
          "Servidor indisponível. Usando cache local.",
          error
        );


        state.deliveries =
          await getCachedDriverDeliveries();

      }

    } else {

      /*
        Sem internet:
        usa diretamente o banco local.
      */

      state.deliveries =
        await getCachedDriverDeliveries();

    }


  } catch (error) {

    console.error(
      "Erro ao carregar entregas do motorista:",
      error
    );


    state.deliveries = [];

  }


  const pending =
    await getPendingCount();


  const connectionNotice =
    !navigator.onLine

      ? `

        <div class="notice">

          <b>
            📴 Sem internet
          </b>

          <br>

          Você pode continuar registrando
          os abastecimentos.
          Os dados ficarão salvos neste aparelho
          e serão enviados automaticamente
          quando a internet voltar.

          ${
            pending > 0
              ? `<br><br><b>${pending}</b> registro(s) aguardando sincronização.`
              : ""
          }

        </div>

      `

      : pending > 0

        ? `

          <div class="notice">

            <b>
              🔄 ${pending}
              registro(s) aguardando sincronização.
            </b>

            <br>

            O aplicativo enviará
            automaticamente quando possível.

          </div>

        `

        : `

          <div class="notice">

            🟢 Internet disponível.
            Dados sincronizados.

          </div>

        `;


  $("driverPanel").innerHTML = `

    <div class="card">

      <div class="panel-title">

        <h2>
          Minhas entregas
        </h2>

      </div>


      ${connectionNotice}


      <div
        class="notice"
        style="margin-top:10px">

        Ao concluir, o registro recebe
        data/hora do servidor quando
        sincronizado.

        <br><br>

        Sem internet, o lançamento fica
        guardado no aparelho.

        <br><br>

        O motorista informa a quantidade
        real.

        O beneficiário confirma por PIN
        e assinatura.

        Se ninguém estiver no local,
        deve haver foto.

      </div>


      <div
        class="grid"
        style="margin-top:14px">

        ${
          state.deliveries
            .map(
              driverCard
            )
            .join("")
          ||
          "<p class='small'>Nenhuma entrega atribuída neste aparelho.</p>"
        }

      </div>

    </div>

  `;


  document
    .querySelectorAll(
      "[data-complete]"
    )
    .forEach(
      b => {

        b.onclick =
          () =>
            showCompleteForm(
              b.dataset.complete
            );

      }
    );


  await updateConnectionStatus();

}


function driverCard(d) {

  const isPendingOffline =
    d.offlinePending ===
    true;


  const action =
    d.status ===
      "scheduled"

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

          ${esc(
            d.recipientName
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

        <b>
          Quando:
        </b>

        ${esc(
          d.scheduledDate
        )}

        ·

        <b>
          Planejado:
        </b>

        ${esc(
          d.plannedLiters
        )} L

      </p>


      <p>

        <b>
          Comunidade:
        </b>

        ${esc(
          d.community
        )}

        <br>

        <b>
          Endereço:
        </b>

        ${esc(
          d.address
        )}

      </p>


      ${
        isPendingOffline

          ? `

            <div class="notice">

              🟠 Registro salvo
              neste aparelho.
              Aguardando internet
              para sincronização.

            </div>

          `

          : ""
      }


      ${action}

    </div>

  `;

}


/* =========================
   REGISTRAR ENTREGA
========================= */

function showCompleteForm(
  id
) {

  const d =
    state.deliveries.find(
      x =>
        x.id === id
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

      ${
        navigator.onLine

          ? `

            🟢 Internet disponível.
            O registro será enviado
            ao sistema.

          `

          : `

            📴 Você está sem internet.
            O registro será salvo
            neste aparelho e enviado
            automaticamente quando a conexão
            voltar.

          `

      }

    </div>


    <div
      class="item">

      <h3>
        ${esc(
          d.recipientName
        )}
      </h3>


      <p>

        <b>
          Comunidade:
        </b>

        ${esc(
          d.community
        )}

      </p>


      <p>

        <b>
          Endereço:
        </b>

        ${esc(
          d.address
        )}

      </p>


      <p>

        <b>
          Quantidade planejada:
        </b>

        ${esc(
          d.plannedLiters
        )} L

      </p>

    </div>


    <form id="completeForm">

      <label>

        Quantidade realmente entregue
        (litros)

        <input
          id="cLiters"
          type="number"
          min="1"
          value="${esc(
            d.plannedLiters
          )}"
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


      <div
        id="recipientFields">

        <label>

          PIN de confirmação
          do beneficiário

          <input
            id="cPin"
            inputmode="numeric"
            maxlength="8"
            placeholder="PIN fornecido ao beneficiário">

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
          (obrigatória se ninguém estiver)

          <input
            id="cPhoto"
            type="file"
            accept="image/*"
            capture="environment">

        </label>


        <p class="small">

          A foto será guardada no aparelho
          se estiver sem internet e enviada
          automaticamente quando a conexão voltar.

        </p>

      </div>


      <label>

        Observação

        <textarea
          id="cNote">
        </textarea>

      </label>


      <button
        class="primary">

        ${
          navigator.onLine
            ? "Finalizar fornecimento"
            : "Salvar no aparelho"
        }

      </button>

    </form>

  `);


  const canvas =
    $("signature");


  const ctx =
    canvas.getContext(
      "2d"
    );


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


  window.addEventListener(
    "resize",
    resize,
    {
      once: true
    }
  );


  function pos(e) {

    const r =
      canvas.getBoundingClientRect();


    const p =
      e.touches
        ? e.touches[0]
        : e;


    return [

      p.clientX -
        r.left,

      p.clientY -
        r.top

    ];

  }


  const start =
    e => {

      drawing =
        true;


      const [
        x,
        y
      ] =
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


      const [
        x,
        y
      ] =
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


  $("completeForm")
    .onsubmit =
    async e => {

      e.preventDefault();


      try {

        const present =
          $("cPresence").value ===
          "yes";


        const receivedLiters =
          Number(
            $("cLiters").value
          );


        if (
          !Number.isFinite(
            receivedLiters
          ) ||
          receivedLiters <= 0
        ) {

          toast(
            "Informe uma quantidade válida."
          );

          return;

        }


        /*
          O PIN só é validado contra o valor
          já carregado na entrega.
        */

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
          isBlankCanvas(
            canvas
          )
        ) {

          toast(
            "Faça a assinatura do beneficiário."
          );

          return;

        }


        let photoBlob =
          null;


        let photoName =
          null;


        let photoType =
          null;


        let signatureData =
          null;


        /*
          Assinatura continua sendo uma imagem
          em Base64, o que permite guardá-la
          facilmente no banco local.
        */

        if (present) {

          signatureData =
            canvas.toDataURL(
              "image/png"
            );

        } else {

          const file =
            $("cPhoto").files[0];


          if (!file) {

            toast(
              "A foto é obrigatória quando não há ninguém no local."
            );

            return;

          }


          /*
            Guardamos o próprio arquivo
            no IndexedDB.
          */

          photoBlob =
            file;


          photoName =
            file.name;


          photoType =
            file.type ||
            "image/jpeg";

        }


        const offline =
          !navigator.onLine;


        /*
          Se estiver offline, criamos um registro
          na fila local.
        */

        if (offline) {

          const localId =
            createLocalId();


          await addSyncQueue({

            localId,

            deliveryId:
              d.id,

            driverUid:
              state.user.uid,

            receivedLiters,

            recipientPresent:
              present,

            signatureData,

            photoBlob,

            photoName,

            photoType,

            note:
              $("cNote")
                .value
                .trim(),

            recordedAt:
              new Date()
                .toISOString(),

            createdLocallyAt:
              new Date()
                .toISOString()

          });


          /*
            Atualiza imediatamente a cópia local
            para o motorista enxergar que a entrega
            já foi registrada.
          */

          await localPut(
            STORE_DELIVERIES,
            {

              ...d,

              status:
                present
                  ? "completed"
                  : "absent",

              receivedLiters,

              recipientPresent:
                present,

              signatureData,

              photoUrl:
                null,

              note:
                $("cNote")
                  .value
                  .trim(),

              completedBy:
                state.user.uid,

              offlinePending:
                true,

              offlineRecordedAt:
                new Date()
                  .toISOString()

            }
          );


          closeModal();


          toast(
            "Registro salvo no aparelho. Será sincronizado automaticamente quando a internet voltar."
          );


          await renderDriver();


          return;

        }


        /*
          Se estiver online:
          fazemos a mesma operação da fila,
          mas imediatamente.
        */

        const localItem = {

          localId:
            createLocalId(),

          deliveryId:
            d.id,

          driverUid:
            state.user.uid,

          receivedLiters,

          recipientPresent:
            present,

          signatureData,

          photoBlob,

          photoName,

          photoType,

          note:
            $("cNote")
              .value
              .trim(),

          recordedAt:
            new Date()
              .toISOString()

        };


        try {

          await syncSingleRecord(
            localItem
          );


          closeModal();


          toast(
            "Fornecimento registrado e sincronizado."
          );


          await renderDriver();


        } catch (onlineError) {

          /*
            Se a internet cair justamente durante
            o envio, não perdemos o lançamento.
            Colocamos na fila.
          */

          console.warn(
            "Falha no envio online. Guardando localmente:",
            onlineError
          );


          await addSyncQueue(
            localItem
          );


          await localPut(
            STORE_DELIVERIES,
            {

              ...d,

              status:
                present
                  ? "completed"
                  : "absent",

              receivedLiters,

              recipientPresent:
                present,

              signatureData,

              photoUrl:
                null,

              note:
                $("cNote")
                  .value
                  .trim(),

              completedBy:
                state.user.uid,

              offlinePending:
                true,

              offlineRecordedAt:
                new Date()
                  .toISOString()

            }
          );


          closeModal();


          toast(
            "A conexão caiu durante o envio. O registro foi salvo no aparelho e será sincronizado automaticamente."
          );


          await renderDriver();

        }


      } catch (error) {

        console.error(
          "Erro ao registrar fornecimento:",
          error
        );


        toast(
          "Não foi possível registrar o fornecimento. O registro não foi apagado."
        );

      }

    };

}


function isBlankCanvas(c) {

  const data =
    c.getContext(
      "2d"
    ).getImageData(
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
    ) {

      return false;

    }

  }


  return true;

}


/* =========================
   BENEFICIÁRIO
========================= */

async function renderRecipient() {

  const q =
    query(
      collection(
        db,
        "deliveries"
      ),
      where(
        "recipientPhone",
        "==",
        state.profile.phone ||
        ""
      ),
      limit(50)
    );


  let ds =
    await getDocs(q)
      .catch(
        error => {

          console.error(
            "Erro ao carregar abastecimentos:",
            error
          );


          return {
            docs: []
          };

        }
      );


  const list =
    ds.docs
      .map(
        d => ({
          id: d.id,
          ...d.data()
        })
      )
      .sort(
        (a, b) =>
          String(
            b.scheduledDate ||
            ""
          ).localeCompare(
            String(
              a.scheduledDate ||
              ""
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

        Se houver divergência,
        procure a administração
        com o número da entrega.

      </div>


      <div
        class="grid"
        style="margin-top:14px">

        ${
          list
            .map(
              recipientCard
            )
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

          ${esc(
            d.scheduledDate
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

        <b>
          Quantidade programada:
        </b>

        ${esc(
          d.plannedLiters
        )} L

      </p>


      <p>

        <b>
          Quantidade registrada:
        </b>


        ${
          d.receivedLiters

            ? `${esc(
                d.receivedLiters
              )} L`

            : "Ainda não registrada"
        }

      </p>


      <p>

        <b>
          Local:
        </b>

        ${esc(
          d.address
        )}

      </p>

    </div>

  `;

}
```
