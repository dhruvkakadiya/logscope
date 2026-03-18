cmake_minimum_required(VERSION 3.20.0)
find_package(Zephyr REQUIRED HINTS $ENV{ZEPHYR_BASE})
project(devscope_log_demo)

target_sources(app PRIVATE
  src/main.c
  src/sensor.c
  src/ble.c
  src/storage.c
)
