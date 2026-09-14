# Água para Todos

MVP de controle de abastecimento por caminhão-pipa, pensado para Areia Branca-RN.

## Estrutura

- `index.html` — interface
- `styles.css` — visual
- `app.js` — autenticação, Firestore, Storage e fluxo de entrega
- `firebase-config.js` — configuração pública do Firebase
- `firestore.rules` — regras de segurança do banco
- `storage.rules` — regras de segurança das fotos
- `manifest.webmanifest` — instalação como PWA

## Modelo de dados

### users/{uid}
- name
- email
- phone
- role: admin | driver | recipient

### households/{id}
- name
- cpf
- phone
- community
- address
- people
- frequency
- defaultLiters
- active
- createdAt
- createdBy

### deliveries/{id}
- householdId
- recipientName
- recipientPhone
- address
- community
- scheduledDate
- plannedLiters
- driverUid
- driverName
- status
- receivedLiters
- recipientPresent
- signatureData
- photoUrl
- completedAt
- completedBy
- note

## Importante

Esta é a primeira versão funcional. Para produção, recomenda-se evoluir para:
1. QR Code/PIN individual do imóvel.
2. GPS obrigatório no momento do abastecimento.
3. Foto com metadados e registro de horário.
4. Trilhas de auditoria imutáveis.
5. Cloud Functions para operações privilegiadas.
6. App Check.
7. Relatórios e exportação para CSV/PDF.
8. Controle de caminhões, placas, rotas e volume do tanque.
9. Painel público de transparência sem expor dados pessoais.
