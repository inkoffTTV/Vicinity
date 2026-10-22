#pragma once
#include <cstdint>
#include <string>

// История звонков 1:1 в личке (docs/CALLS.md §3.4): сервер следит за сигналингом и, когда звонок
// заканчивается, кладёт в личку сообщение kind="call" от звонящего с meta {result, duration}:
// result — ok (поговорили), missed (не ответили или адресата нет в сети), declined (отклонили).
namespace Calls {

// Сигнал прошёл проверку доступа и уходит адресату (или адресата нет в сети — delivered=false)
void onSignal(const std::string& type, int64_t from, int64_t to, const std::string& reason, bool delivered);

// Сообщение-звонок в личку этих двоих (личка создаётся, если её нет) + рассылка new_message.
// Без исключений: история звонков — не повод ломать сам звонок.
void record(int64_t caller, int64_t callee, const std::string& result, int64_t durationSec);

} // namespace Calls
