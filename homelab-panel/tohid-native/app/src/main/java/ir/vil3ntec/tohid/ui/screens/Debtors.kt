package ir.vil3ntec.tohid.ui.screens

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowForward
import androidx.compose.material.icons.filled.DeleteOutline
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import ir.vil3ntec.tohid.data.Debtor
import ir.vil3ntec.tohid.data.DebtorEngine
import ir.vil3ntec.tohid.data.ShopData
import ir.vil3ntec.tohid.data.ShopStore
import ir.vil3ntec.tohid.formatDate
import ir.vil3ntec.tohid.money
import ir.vil3ntec.tohid.plain
import ir.vil3ntec.tohid.todayIso
import ir.vil3ntec.tohid.ui.theme.Radius
import ir.vil3ntec.tohid.ui.theme.Shop
import kotlinx.coroutines.launch

/**
 *  قرض‌داران.
 *
 *  مانده هیچ‌جا ذخیره نمی‌شود: همیشه «آنچه گرفته منهای آنچه پس داده».
 *  فروشِ نسیه هم از همین راه می‌آید، پس حسابِ یک نفر چه از صندوق پر شود
 *  چه با دست، یک عدد است.
 */
@Composable
fun DebtorsScreen(store: ShopStore, d: ShopData, snackbar: SnackbarHostState) {
  val scope = rememberCoroutineScope()

  var search by rememberSaveable { mutableStateOf("") }
  var openId by rememberSaveable { mutableStateOf<String?>(null) }
  var form by remember { mutableStateOf<DebtorFormState?>(null) }
  var txFor by remember { mutableStateOf<Pair<String, DebtorEngine.Kind>?>(null) }
  var confirmDelete by remember { mutableStateOf<Debtor?>(null) }
  var confirmTx by remember { mutableStateOf<String?>(null) }

  fun toast(text: String) {
    scope.launch { snackbar.showSnackbar(text) }
  }

  fun apply(result: DebtorEngine.Result, done: String, after: () -> Unit = {}) {
    when (result) {
      is DebtorEngine.Result.Failed -> toast(result.message)
      is DebtorEngine.Result.Ok -> {
        scope.launch { store.save(result.data) }
        toast(done)
        after()
      }
    }
  }

  // قرض‌داری که حذف شده نباید صفحه‌اش باز بماند
  LaunchedEffect(d.debtors.size) {
    if (openId != null && d.debtors.none { it.id == openId }) openId = null
  }
  BackHandler(enabled = openId != null) { openId = null }

  val account = openId?.let { DebtorEngine.account(d, it) }

  if (account != null) {
    AccountView(
      account = account,
      onBack = { openId = null },
      onGive = { txFor = account.debtor.id to DebtorEngine.Kind.GIVE },
      onReceive = { txFor = account.debtor.id to DebtorEngine.Kind.RECEIVE },
      onEdit = { form = DebtorFormState.of(account.debtor) },
      onDelete = { confirmDelete = account.debtor },
      onDeleteTx = { confirmTx = it },
    )
  } else {
    val rows = d.debtors
      .filter {
        search.isBlank() || it.name.contains(search.trim(), ignoreCase = true) ||
          it.phone.contains(search.trim())
      }
      .map { it to ShopStore.debt(d, it.id) }
      .sortedByDescending { it.second }

    Box(Modifier.fillMaxSize()) {
      LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp, 16.dp, 16.dp, 96.dp)) {
        item {
          Text("قرض‌داران", style = MaterialTheme.typography.headlineMedium, color = Shop.colors.text)
          Spacer(Modifier.height(14.dp))

          val owed = rows.sumOf { it.second.coerceAtLeast(0.0) }
          StatTile(
            label = "جمع طلب از مشتریان",
            value = "${money(owed)} افغانی",
            tint = if (owed > 0) Shop.colors.warning else Shop.colors.success,
            hint = "${plain(d.debtors.size)} قرض‌دار",
            modifier = Modifier.fillMaxWidth(),
          )
          Spacer(Modifier.height(12.dp))

          OutlinedTextField(
            value = search,
            onValueChange = { search = it },
            placeholder = { Text("جستجوی نام یا شماره") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
          )
          Spacer(Modifier.height(14.dp))
        }

        if (rows.isEmpty()) {
          item {
            Panel {
              EmptyNote(
                if (d.debtors.isEmpty()) "هنوز قرض‌داری ثبت نشده."
                else "قرض‌داری با این جستجو پیدا نشد."
              )
            }
          }
        } else {
          items(rows, key = { it.first.id }) { (debtor, balance) ->
            DebtorRow(debtor, balance) { openId = debtor.id }
            Spacer(Modifier.height(8.dp))
          }
        }
      }

      ExtendedFloatingActionButton(
        onClick = { form = DebtorFormState() },
        containerColor = Shop.colors.primary,
        contentColor = Color.White,
        modifier = Modifier.align(Alignment.BottomStart).padding(16.dp),
        icon = { Icon(Icons.Filled.Add, contentDescription = null) },
        text = { Text("قرض‌دار تازه") },
      )
    }
  }

  /* ---------------------------- پنجره‌ها ---------------------------- */

  form?.let { state ->
    DebtorDialog(
      state = state,
      onDismiss = { form = null },
      onSave = { draft ->
        val result = if (state.editingId == null) {
          DebtorEngine.add(d, draft, System.currentTimeMillis(), ::newId)
        } else {
          DebtorEngine.edit(d, state.editingId, draft)
        }
        apply(result, if (state.editingId == null) "با موفقیت ثبت شد" else "با موفقیت ویرایش شد") {
          form = null
        }
      },
    )
  }

  txFor?.let { (debtorId, kind) ->
    TransactionDialog(
      debtor = d.debtors.find { it.id == debtorId },
      balance = ShopStore.debt(d, debtorId),
      kind = kind,
      onDismiss = { txFor = null },
      onSave = { amount, date, notes ->
        apply(
          DebtorEngine.addTransaction(
            d, debtorId, kind, amount, date, notes, todayIso(), System.currentTimeMillis(), ::newId,
          ),
          "با موفقیت ثبت شد",
        ) { txFor = null }
      },
    )
  }

  confirmDelete?.let { debtor ->
    AlertDialog(
      onDismissRequest = { confirmDelete = null },
      containerColor = Shop.colors.surface,
      title = { Text("حذف قرض‌دار؟", color = Shop.colors.text) },
      text = {
        Text(
          DebtorEngine.deleteWarning(d, debtor.id),
          style = MaterialTheme.typography.bodySmall,
          color = Shop.colors.muted,
        )
      },
      confirmButton = {
        TextButton(onClick = {
          apply(DebtorEngine.delete(d, debtor.id), "با موفقیت حذف شد") {
            confirmDelete = null
            openId = null
          }
        }) { Text("حذف", color = Shop.colors.danger) }
      },
      dismissButton = { TextButton(onClick = { confirmDelete = null }) { Text("انصراف") } },
    )
  }

  confirmTx?.let { txId ->
    AlertDialog(
      onDismissRequest = { confirmTx = null },
      containerColor = Shop.colors.surface,
      title = { Text("حذف تراکنش؟", color = Shop.colors.text) },
      text = {
        Text(
          "این تراکنش پاک می‌شود و مانده حساب دوباره حساب می‌شود.",
          style = MaterialTheme.typography.bodySmall,
          color = Shop.colors.muted,
        )
      },
      confirmButton = {
        TextButton(onClick = {
          apply(DebtorEngine.deleteTransaction(d, txId), "تراکنش حذف شد") { confirmTx = null }
        }) { Text("حذف", color = Shop.colors.danger) }
      },
      dismissButton = { TextButton(onClick = { confirmTx = null }) { Text("انصراف") } },
    )
  }
}

/* ============================ تکه‌ها ============================ */

@Composable
private fun DebtorRow(debtor: Debtor, balance: Double, onClick: () -> Unit) {
  Row(
    Modifier
      .fillMaxWidth()
      .clip(RoundedCornerShape(Radius.md))
      .background(Shop.colors.surface)
      .border(1.dp, Shop.colors.border, RoundedCornerShape(Radius.md))
      .clickable(onClick = onClick)
      .padding(14.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    Column(Modifier.weight(1f)) {
      Text(
        debtor.name.ifBlank { "بی‌نام" },
        style = MaterialTheme.typography.titleSmall,
        color = Shop.colors.text,
      )
      Spacer(Modifier.height(3.dp))
      Text(
        DebtorEngine.stateText(balance),
        style = MaterialTheme.typography.labelSmall,
        color = Shop.colors.muted,
      )
    }
    Text(
      "${money(kotlin.math.abs(balance))} افغانی",
      style = MaterialTheme.typography.titleSmall,
      color = when {
        balance > 0 -> Shop.colors.warning
        balance < 0 -> Shop.colors.success
        else -> Shop.colors.muted
      },
      fontWeight = FontWeight.Bold,
    )
  }
}

/** حسابِ یک نفر — مانده، دکمه‌ها، و همهٔ تراکنش‌هایش */
@Composable
private fun AccountView(
  account: DebtorEngine.Account,
  onBack: () -> Unit,
  onGive: () -> Unit,
  onReceive: () -> Unit,
  onEdit: () -> Unit,
  onDelete: () -> Unit,
  onDeleteTx: (String) -> Unit,
) {
  LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp)) {
    item {
      TextButton(onClick = onBack) {
        Icon(Icons.Filled.ArrowForward, contentDescription = null, tint = Shop.colors.primary)
        Spacer(Modifier.width(6.dp))
        Text("بازگشت به فهرست", color = Shop.colors.primary)
      }
      Spacer(Modifier.height(6.dp))

      Text(account.debtor.name, style = MaterialTheme.typography.headlineMedium, color = Shop.colors.text)
      if (account.debtor.phone.isNotBlank()) {
        Text(account.debtor.phone, style = MaterialTheme.typography.bodySmall, color = Shop.colors.muted)
      }
      if (account.debtor.notes.isNotBlank()) {
        Spacer(Modifier.height(4.dp))
        Text(account.debtor.notes, style = MaterialTheme.typography.labelSmall, color = Shop.colors.muted2)
      }
      Spacer(Modifier.height(14.dp))

      StatTile(
        label = DebtorEngine.stateText(account.balance),
        value = "${money(kotlin.math.abs(account.balance))} افغانی",
        tint = when {
          account.balance > 0 -> Shop.colors.warning
          account.balance < 0 -> Shop.colors.success
          else -> Shop.colors.muted
        },
        hint = "گرفته: ${money(account.given)} — پس داده: ${money(account.received)}",
        modifier = Modifier.fillMaxWidth(),
      )

      Spacer(Modifier.height(12.dp))
      Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Button(onClick = onReceive, modifier = Modifier.weight(1f)) { Text("پول گرفتم") }
        OutlinedButton(onClick = onGive, modifier = Modifier.weight(1f)) { Text("قرض دادم") }
      }
      Spacer(Modifier.height(6.dp))
      Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedButton(onClick = onEdit, modifier = Modifier.weight(1f)) { Text("ویرایش") }
        OutlinedButton(
          onClick = onDelete,
          colors = ButtonDefaults.outlinedButtonColors(contentColor = Shop.colors.danger),
          modifier = Modifier.weight(1f),
        ) { Text("حذف") }
      }

      Spacer(Modifier.height(18.dp))
      SectionTitle("تراکنش‌ها")
    }

    if (account.transactions.isEmpty()) {
      item { Panel { EmptyNote("هنوز تراکنشی برای این حساب ثبت نشده.") } }
    } else {
      items(account.transactions, key = { it.id }) { tx ->
        val isGive = tx.type == "give"
        Row(
          Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(Radius.sm))
            .background(Shop.colors.surface)
            .padding(12.dp),
          verticalAlignment = Alignment.CenterVertically,
        ) {
          Column(Modifier.weight(1f)) {
            Text(
              if (isGive) "قرض داده شد" else "پول گرفته شد",
              style = MaterialTheme.typography.bodyMedium,
              color = Shop.colors.text,
            )
            Text(
              "${formatDate(tx.date)}${if (tx.notes.isNotBlank()) " — ${tx.notes}" else ""}",
              style = MaterialTheme.typography.labelSmall,
              color = Shop.colors.muted,
            )
          }
          Text(
            "${if (isGive) "+" else "−"}${money(tx.amount)}",
            style = MaterialTheme.typography.titleSmall,
            color = if (isGive) Shop.colors.warning else Shop.colors.success,
          )
          IconButton(onClick = { onDeleteTx(tx.id) }) {
            Icon(Icons.Filled.DeleteOutline, contentDescription = "حذف تراکنش", tint = Shop.colors.muted2)
          }
        }
        Spacer(Modifier.height(6.dp))
      }
    }
  }
}

/* ============================ فرم‌ها ============================ */

data class DebtorFormState(
  val editingId: String? = null,
  val name: String = "",
  val phone: String = "",
  val notes: String = "",
) {
  companion object {
    fun of(d: Debtor) = DebtorFormState(d.id, d.name, d.phone, d.notes)
  }
}

@Composable
private fun DebtorDialog(
  state: DebtorFormState,
  onDismiss: () -> Unit,
  onSave: (DebtorEngine.DebtorDraft) -> Unit,
) {
  var form by remember(state.editingId) { mutableStateOf(state) }

  Dialog(onDismissRequest = onDismiss) {
    Surface(color = Shop.colors.surface, shape = RoundedCornerShape(Radius.lg), modifier = Modifier.fillMaxWidth()) {
      Column(Modifier.padding(18.dp).verticalScroll(rememberScrollState())) {
        Text(
          if (form.editingId == null) "قرض‌دار تازه" else "ویرایش قرض‌دار",
          style = MaterialTheme.typography.titleMedium,
          color = Shop.colors.text,
        )
        Spacer(Modifier.height(14.dp))

        OutlinedTextField(form.name, { form = form.copy(name = it) }, label = { Text("نام") },
          singleLine = true, modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.height(10.dp))
        OutlinedTextField(form.phone, { form = form.copy(phone = it) }, label = { Text("تلفن (اختیاری)") },
          singleLine = true, modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.height(10.dp))
        OutlinedTextField(form.notes, { form = form.copy(notes = it) }, label = { Text("یادداشت (اختیاری)") },
          modifier = Modifier.fillMaxWidth())

        Spacer(Modifier.height(18.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
          OutlinedButton(onClick = onDismiss, modifier = Modifier.weight(1f)) { Text("انصراف") }
          Button(
            onClick = { onSave(DebtorEngine.DebtorDraft(form.name, form.phone, form.notes)) },
            modifier = Modifier.weight(1f),
          ) { Text("ذخیره") }
        }
      }
    }
  }
}

@Composable
private fun TransactionDialog(
  debtor: Debtor?,
  balance: Double,
  kind: DebtorEngine.Kind,
  onDismiss: () -> Unit,
  onSave: (Double, String, String) -> Unit,
) {
  var amount by remember { mutableStateOf("") }
  var date by remember { mutableStateOf(todayIso()) }
  var notes by remember { mutableStateOf("") }
  val receiving = kind == DebtorEngine.Kind.RECEIVE

  Dialog(onDismissRequest = onDismiss) {
    Surface(color = Shop.colors.surface, shape = RoundedCornerShape(Radius.lg), modifier = Modifier.fillMaxWidth()) {
      Column(Modifier.padding(18.dp).verticalScroll(rememberScrollState())) {
        Text(
          if (receiving) "پول گرفتم" else "قرض دادم",
          style = MaterialTheme.typography.titleMedium,
          color = Shop.colors.text,
        )
        if (debtor != null) {
          Spacer(Modifier.height(4.dp))
          Text(
            "${debtor.name} — ${DebtorEngine.stateText(balance)}",
            style = MaterialTheme.typography.bodySmall,
            color = Shop.colors.muted,
          )
        }

        Spacer(Modifier.height(14.dp))
        AmountField(amount, { amount = it }, "مبلغ")

        // میان‌بُرِ «تسویهٔ کامل» فقط وقتی معنی دارد که بدهکار باشد
        if (receiving && balance > 0) {
          Spacer(Modifier.height(6.dp))
          TextButton(onClick = { amount = Math.round(balance).toString() }) {
            Text("تسویهٔ کامل", color = Shop.colors.primary)
          }
        }

        Spacer(Modifier.height(8.dp))
        DateField(date) { date = it }

        Spacer(Modifier.height(10.dp))
        OutlinedTextField(notes, { notes = it }, label = { Text("یادداشت (اختیاری)") },
          modifier = Modifier.fillMaxWidth())

        Spacer(Modifier.height(18.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
          OutlinedButton(onClick = onDismiss, modifier = Modifier.weight(1f)) { Text("انصراف") }
          Button(
            onClick = { onSave(amount.toDoubleOrNull() ?: 0.0, date, notes) },
            modifier = Modifier.weight(1f),
          ) { Text("ثبت") }
        }
      }
    }
  }
}
