// Загрузчик emscripten в rnnoise.js (@shiguredo/rnnoise-wasm) проверяет, что он в окне или воркере.
// В AudioWorkletGlobalScope нет ни того ни другого — подставляем пустой WorkerGlobalScope до импорта.
if (typeof globalThis.WorkerGlobalScope === 'undefined') globalThis.WorkerGlobalScope = function WorkerGlobalScope() {};
