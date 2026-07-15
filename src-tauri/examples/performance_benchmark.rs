fn main() {
    if let Err(error) = novasvn_lib::performance_benchmark::run_cli(std::env::args().skip(1)) {
        eprintln!("性能基准失败：{error}");
        std::process::exit(1);
    }
}
