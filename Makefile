.PHONY: apply delete

apply:
	@@$(MAKE) delete || true
	kubectl apply -f job.yaml

delete:
	kubectl delete job nodbox
