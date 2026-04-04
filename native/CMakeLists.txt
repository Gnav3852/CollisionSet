cmake_minimum_required(VERSION 3.16)
project(oracle_wasm CXX)

option(ORACLE_ZENO_DEBUG "Enable Zeno circuit breaker + verbose std::cout diagnostics (noisy WASM)" OFF)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

if(NOT EMSCRIPTEN)
  message(FATAL_ERROR "Configure with Emscripten: emcmake cmake -S native -B native/build")
endif()

add_executable(oracle_wasm
  src/collision_math.cpp
  src/oracle_engine.cpp
  src/bindings.cpp
)

target_include_directories(oracle_wasm PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/include")

if(ORACLE_ZENO_DEBUG)
  target_compile_definitions(oracle_wasm PRIVATE ORACLE_ZENO_DEBUG=1)
endif()

set_target_properties(oracle_wasm PROPERTIES OUTPUT_NAME "oracle")

target_link_options(oracle_wasm PRIVATE
  "-O3"
  "-sMODULARIZE=1"
  "-sEXPORT_ES6=1"
  "-sENVIRONMENT=web"
  "-sALLOW_MEMORY_GROWTH=1"
  "-sEXPORTED_RUNTIME_METHODS=['ccall','cwrap','HEAPU8','HEAP32','HEAPF64']"
  "SHELL:-sEXPORTED_FUNCTIONS=[_malloc,_free,_oracle_create,_oracle_destroy,_oracle_set_particle_count,_oracle_set_particle,_oracle_bootstrap,_oracle_get_sim_time,_oracle_get_particle_count,_oracle_get_capacity,_oracle_particles_ptr,_oracle_step,_oracle_purge_heap,_oracle_peek_impact,_oracle_heap_size,_oracle_peek_valid,_oracle_peek_time,_oracle_peek_kind,_oracle_peek_a,_oracle_peek_b,_oracle_peek_wall,_oracle_peek_count_a,_oracle_peek_count_b,_oracle_heap_export]"
)

set(WASM_OUT "${CMAKE_CURRENT_SOURCE_DIR}/../src/wasm")

add_custom_command(TARGET oracle_wasm POST_BUILD
  COMMAND ${CMAKE_COMMAND} -E make_directory "${WASM_OUT}"
  COMMAND ${CMAKE_COMMAND} -E copy_if_different
    "$<TARGET_FILE:oracle_wasm>"
    "${WASM_OUT}/oracle.js"
  COMMAND ${CMAKE_COMMAND} -E copy_if_different
    "${CMAKE_CURRENT_BINARY_DIR}/oracle.wasm"
    "${WASM_OUT}/oracle.wasm"
  COMMENT "Copying oracle.js and oracle.wasm to src/wasm (Vite assets)"
)
